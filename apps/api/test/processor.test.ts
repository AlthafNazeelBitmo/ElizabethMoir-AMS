import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { describeError } from "../src/processing/processor.js";
import {
  calendarDays,
  dayRecords,
  devices,
  groups,
  people,
  rawEvents,
  scans,
  unknownEnrollments,
} from "../src/db/schema/index.js";
import {
  createHarness,
  INGEST_TOKEN,
  REPORT_TOKEN,
  type TestHarness,
} from "./helpers/app.js";

/**
 * The processor end to end: a webhook delivery becomes scans and a derived
 * day record, and doing it twice changes nothing.
 *
 * Times are Colombo local, as the feed sends them. 07:30 local is 02:00 UTC.
 */
const GATE = "TEST000000001";
const SCHOOL_DAY = "2026-09-16";

let h: TestHarness;

/** Late enough in the day that absence may be decided. */
const AFTERNOON = new Date("2026-09-16T09:00:00.000Z");

beforeAll(async () => {
  h = await createHarness({ now: AFTERNOON });
}, 60_000);

beforeEach(async () => {
  h.setNow(AFTERNOON);
  await h.db.truncateAll();
  await h.app.settings.invalidate();
  // The seed migration's groups and settings are removed by truncation, so
  // re-create what these tests rely on.
  await h.db.db
    .insert(groups)
    .values({ name: "Form 1", branch: "student", displayOrder: 1 });
  await h.db.db
    .insert(calendarDays)
    .values({ date: SCHOOL_DAY, type: "school_day" });
});

afterAll(async () => {
  await h.close();
});

function event(
  empId: string,
  attTime: string,
  checkingStatus = "0",
  device = GATE,
) {
  return {
    EmpId: empId,
    AttTime: attTime,
    CheckingStatus: checkingStatus,
    VerifyType: "1",
    DeviceID: device,
  };
}

async function deliver(events: unknown[]) {
  const res = await h.app.server.inject({
    method: "POST",
    url: `/ingest/${INGEST_TOKEN}/raw`,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(events),
  });
  expect(res.statusCode).toBe(200);
}

async function addPerson(enrollNo: string, fullName: string) {
  const [group] = await h.db.db
    .select()
    .from(groups)
    .where(eq(groups.branch, "student"));
  const [row] = await h.db.db
    .insert(people)
    .values({ enrollNo, fullName, groupId: group!.id })
    .returning();
  return row!;
}

describe("a delivery becomes scans", () => {
  it("converts the transmitted local time to the right instant", async () => {
    await addPerson("11007", "A Student");
    await deliver([event("11007", "2026-09-16 07:30:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();

    const [scan] = await h.db.db.select().from(scans);
    expect(scan?.attTimeLocal).toBe("2026-09-16 07:30:00");
    // Colombo is UTC+5:30 all year.
    expect(scan?.attTime.toISOString()).toBe("2026-09-16T02:00:00.000Z");
  });

  it("keeps the vendor's fields", async () => {
    await addPerson("11007", "A Student");
    await deliver([event("11007", "2026-09-16 07:30:00", "1")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();

    const [scan] = await h.db.db.select().from(scans);
    expect(scan?.enrollNo).toBe("11007");
    expect(scan?.checkingStatus).toBe("1");
    expect(scan?.verifyType).toBe("1");
    expect(scan?.deviceSerial).toBe(GATE);
  });

  it("reads the vendor's other spelling of the verify-type key", async () => {
    await addPerson("11007", "A Student");
    await deliver([
      {
        EmpId: "11007",
        AttTime: "2026-09-16 07:30:00",
        CheckingStatus: "0",
        // The spelling from their reference PHP, not their sample JSON.
        VeryfyType: "4",
        DeviceID: GATE,
      },
    ]);
    await h.app.whenIdle();
    await h.app.processor.processPending();
    expect((await h.db.db.select().from(scans))[0]?.verifyType).toBe("4");
  });

  it("marks the envelope processed", async () => {
    await deliver([event("11007", "2026-09-16 07:30:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();
    const [raw] = await h.db.db.select().from(rawEvents);
    expect(raw?.processedAt).not.toBeNull();
    expect(raw?.processError).toBeNull();
  });

  it("registers the device on first sight, bidirectional until told otherwise", async () => {
    await deliver([event("11007", "2026-09-16 07:30:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();
    const [device] = await h.db.db.select().from(devices);
    expect(device?.serial).toBe(GATE);
    expect(device?.direction).toBe("both");
    expect(device?.trustCheckingStatus).toBe(false);
    expect(device?.lastSeenAt).not.toBeNull();
  });
});

describe("replay is idempotent", () => {
  it("does not duplicate scans when the same delivery is processed twice", async () => {
    await addPerson("11007", "A Student");
    await deliver([event("11007", "2026-09-16 07:30:00")]);

    await h.app.whenIdle();
    await h.app.processor.processPending();
    // Mark it outstanding again, as a replay would.
    await h.db.db.update(rawEvents).set({ processedAt: null });
    const second = await h.app.processor.processPending();

    expect(await h.db.db.select().from(scans)).toHaveLength(1);
    expect(second.scansSkippedAsDuplicate).toBe(1);
    expect(second.scansInserted).toBe(0);
  });

  it("does not duplicate when the platform redelivers the same batch", async () => {
    await addPerson("11007", "A Student");
    const batch = [event("11007", "2026-09-16 07:30:00")];
    await deliver(batch);
    await deliver(batch);
    await h.app.whenIdle();
    await h.app.processor.processPending();
    expect(await h.db.db.select().from(scans)).toHaveLength(1);
  });

  it("keeps the vendor's same-second pair as two rows", async () => {
    await addPerson("11007", "A Student");
    await deliver([
      event("11007", "2026-09-16 07:30:00", "0"),
      event("11007", "2026-09-16 07:30:00", "1"),
    ]);
    await h.app.whenIdle();
    await h.app.processor.processPending();
    // Both preserved, because it is not yet known whether they are real.
    expect(await h.db.db.select().from(scans)).toHaveLength(2);
    // But they are one movement in the derived record.
    const [person] = await h.db.db.select().from(people);
    const [record] = await h.db.db
      .select()
      .from(dayRecords)
      .where(eq(dayRecords.personId, person!.id));
    expect(record?.status).toBe("on_site");
    expect(record?.scanCount).toBe(2);
  });
});

describe("unknown enrollment numbers", () => {
  it("stores the scan with no person rather than discarding it", async () => {
    await deliver([event("99999", "2026-09-16 07:30:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();
    const [scan] = await h.db.db.select().from(scans);
    expect(scan?.enrollNo).toBe("99999");
    expect(scan?.personId).toBeNull();
  });

  it("surfaces the number with first and last seen times and a count", async () => {
    await deliver([
      event("99999", "2026-09-16 07:30:00"),
      event("99999", "2026-09-16 15:00:00"),
    ]);
    await h.app.whenIdle();
    await h.app.processor.processPending();
    const [unknown] = await h.db.db.select().from(unknownEnrollments);
    expect(unknown?.enrollNo).toBe("99999");
    expect(unknown?.scanCount).toBe(2);
    expect(unknown?.firstSeenAt?.toISOString()).toBe(
      "2026-09-16T02:00:00.000Z",
    );
    expect(unknown?.lastSeenAt?.toISOString()).toBe("2026-09-16T09:30:00.000Z");
  });

  it("creates no day record until somebody is attached", async () => {
    await deliver([event("99999", "2026-09-16 07:30:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();
    expect(await h.db.db.select().from(dayRecords)).toHaveLength(0);
  });

  it("matches unknown numbers against the directory once they have a name", async () => {
    // The readers send first; the directory arrives days later.
    await deliver([
      event("11007", "2026-09-16 07:30:00"),
      event("11007", "2026-09-16 15:00:00"),
      event("99999", "2026-09-16 07:31:00"),
    ]);
    await h.app.whenIdle();
    await h.app.processor.processPending();
    expect(await h.db.db.select().from(dayRecords)).toHaveLength(0);

    // Nothing to do yet: nobody is named.
    expect(await h.app.processor.matchUnknownToDirectory()).toEqual({
      people: 0,
      scans: 0,
      days: 0,
      remaining: 0,
    });

    const person = await addPerson("11007", "Named Later");
    const matched = await h.app.processor.matchUnknownToDirectory();
    expect(matched).toEqual({ people: 1, scans: 2, days: 1, remaining: 0 });

    const own = await h.db.db
      .select()
      .from(scans)
      .where(eq(scans.enrollNo, "11007"));
    expect(own.every((s) => s.personId === person.id)).toBe(true);
    const [record] = await h.db.db
      .select()
      .from(dayRecords)
      .where(eq(dayRecords.personId, person.id));
    expect(record?.status).toBe("departed");
    const unknown = await h.db.db.select().from(unknownEnrollments);
    expect(unknown.find((u) => u.enrollNo === "11007")?.resolvedPersonId).toBe(person.id);
    // The number nobody has named is left alone.
    expect(unknown.find((u) => u.enrollNo === "99999")?.resolvedPersonId).toBeNull();

    // Done once; doing it again finds nothing.
    expect(await h.app.processor.matchUnknownToDirectory()).toEqual({
      people: 0,
      scans: 0,
      days: 0,
      remaining: 0,
    });
  });

  it("works through a large arrival in batches, saying how many are left", async () => {
    await deliver([
      event("11001", "2026-09-16 07:30:00"),
      event("11002", "2026-09-16 07:31:00"),
      event("11003", "2026-09-16 07:32:00"),
    ]);
    await h.app.whenIdle();
    await h.app.processor.processPending();
    for (const n of ["11001", "11002", "11003"]) await addPerson(n, `Person ${n}`);

    const first = await h.app.processor.matchUnknownToDirectory(2);
    expect(first).toMatchObject({ people: 2, remaining: 1 });
    const second = await h.app.processor.matchUnknownToDirectory(2);
    expect(second).toMatchObject({ people: 1, remaining: 0 });
    expect(
      (await h.db.db.select().from(scans)).every((s) => s.personId !== null),
    ).toBe(true);
  });

  it("treats a deactivated person's number as nobody's", async () => {
    const person = await addPerson("11007", "Left The School");
    await h.db.db
      .update(people)
      .set({ isActive: false })
      .where(eq(people.id, person.id));
    // Earlier, while they were active, the number was attached to them.
    await h.db.db.insert(unknownEnrollments).values({
      enrollNo: "11007",
      firstSeenAt: new Date("2026-09-01T02:00:00.000Z"),
      lastSeenAt: new Date("2026-09-01T02:00:00.000Z"),
      scanCount: 1,
      resolvedPersonId: person.id,
    });

    await deliver([event("11007", "2026-09-16 07:30:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();

    const [scan] = await h.db.db.select().from(scans);
    expect(scan?.personId).toBeNull();
    // Back on the unknown list: whoever it was attached to no longer holds it.
    const [unknown] = await h.db.db.select().from(unknownEnrollments);
    expect(unknown?.resolvedPersonId).toBeNull();
    expect(unknown?.scanCount).toBe(2);
    expect(unknown?.lastSeenAt?.toISOString()).toBe("2026-09-16T02:00:00.000Z");
  });
});

describe("the derived day record", () => {
  it("records an arrival as on site", async () => {
    const person = await addPerson("11007", "A Student");
    await deliver([event("11007", "2026-09-16 07:30:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();

    const [record] = await h.db.db
      .select()
      .from(dayRecords)
      .where(eq(dayRecords.personId, person.id));
    expect(record?.date).toBe(SCHOOL_DAY);
    expect(record?.status).toBe("on_site");
    expect(record?.firstIn?.toISOString()).toBe("2026-09-16T02:00:00.000Z");
    expect(record?.lastOut).toBeNull();
    expect(record?.isLate).toBe(false);
  });

  it("records an arrival and a departure as departed", async () => {
    const person = await addPerson("11007", "A Student");
    await deliver([
      event("11007", "2026-09-16 07:30:00"),
      event("11007", "2026-09-16 15:00:00"),
    ]);
    await h.app.whenIdle();
    await h.app.processor.processPending();

    const [record] = await h.db.db
      .select()
      .from(dayRecords)
      .where(eq(dayRecords.personId, person.id));
    expect(record?.status).toBe("departed");
    expect(record?.lastOut?.toISOString()).toBe("2026-09-16T09:30:00.000Z");
  });

  it("flags a late arrival while still recording them as on site", async () => {
    const person = await addPerson("11007", "A Student");
    await deliver([event("11007", "2026-09-16 08:45:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();

    const [record] = await h.db.db
      .select()
      .from(dayRecords)
      .where(eq(dayRecords.personId, person.id));
    expect(record?.status).toBe("on_site");
    expect(record?.isLate).toBe(true);
  });

  it("alternates arrival and departure across the day", async () => {
    await addPerson("11007", "A Student");
    await deliver([
      event("11007", "2026-09-16 07:30:00"),
      event("11007", "2026-09-16 12:00:00"),
      event("11007", "2026-09-16 13:00:00"),
    ]);
    await h.app.whenIdle();
    await h.app.processor.processPending();

    const rows = await h.db.db.select().from(scans).orderBy(scans.attTime);
    expect(rows.map((r) => r.direction)).toEqual(["in", "out", "in"]);
    expect(rows.every((r) => r.directionSource === "sequence")).toBe(true);
  });

  it("corrects earlier scans when one arrives out of order", async () => {
    await addPerson("11007", "A Student");
    // The departure is delivered before the arrival it follows.
    await deliver([event("11007", "2026-09-16 15:00:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();
    expect((await h.db.db.select().from(scans))[0]?.direction).toBe("in");

    await deliver([event("11007", "2026-09-16 07:30:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();

    const rows = await h.db.db.select().from(scans).orderBy(scans.attTime);
    expect(rows.map((r) => r.direction)).toEqual(["in", "out"]);
  });

  it("uses the device's configured direction when an administrator has set one", async () => {
    await addPerson("11007", "A Student");
    await deliver([event("11007", "2026-09-16 07:30:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();

    await h.db.db
      .update(devices)
      .set({ direction: "exit" })
      .where(eq(devices.serial, GATE));
    await h.app.processor.recomputePersonDay("11007", SCHOOL_DAY);

    const [scan] = await h.db.db.select().from(scans);
    expect(scan?.direction).toBe("out");
    expect(scan?.directionSource).toBe("device");
  });

  it("does not mark anyone absent on a date the calendar does not know", async () => {
    await addPerson("11007", "A Student");
    await h.db.db.delete(calendarDays);
    await deliver([event("11007", "2026-09-16 07:30:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();

    const [record] = await h.db.db.select().from(dayRecords);
    expect(record?.status).toBe("not_expected");
  });

  it("does not overwrite a day an administrator has corrected by hand", async () => {
    const person = await addPerson("11007", "A Student");
    await deliver([event("11007", "2026-09-16 07:30:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();

    await h.db.db
      .update(dayRecords)
      .set({ hasManualEdit: true, status: "departed" })
      .where(eq(dayRecords.personId, person.id));

    await deliver([event("11007", "2026-09-16 16:00:00")]);
    await h.app.whenIdle();
    await h.app.processor.processPending();

    const [record] = await h.db.db
      .select()
      .from(dayRecords)
      .where(eq(dayRecords.personId, person.id));
    expect(record?.status).toBe("departed");
    expect(record?.hasManualEdit).toBe(true);
  });
});

describe("bad input", () => {
  it("records a reason and moves on rather than stalling the queue", async () => {
    await deliver([
      { EmpId: "11007", AttTime: "not a timestamp", DeviceID: GATE },
      event("11008", "2026-09-16 07:30:00"),
    ]);
    await h.app.whenIdle();
    await h.app.whenIdle();
    await h.app.processor.processPending();

    // The usable event in the same batch still landed.
    expect(await h.db.db.select().from(scans)).toHaveLength(1);
    const [raw] = await h.db.db.select().from(rawEvents);
    expect(raw?.processedAt).not.toBeNull();
    expect(raw?.processError).toMatch(/not YYYY-MM-DD/);
  });

  it("survives a batch that is not an array", async () => {
    await deliver([]);
    await h.db.db
      .update(rawEvents)
      .set({ bodyJson: { nonsense: true }, processedAt: null });
    const result = await h.app.processor.processPending();
    expect(result.problems).toBeGreaterThan(0);
    expect(
      (await h.db.db.select().from(rawEvents))[0]?.processedAt,
    ).not.toBeNull();
  });
});

describe("the scheduled drain endpoint", () => {
  it("404s without the token", async () => {
    const res = await h.app.server.inject({
      method: "GET",
      url: "/internal/process",
    });
    expect(res.statusCode).toBe(404);
  });

  it("processes outstanding envelopes when authorised", async () => {
    await addPerson("11007", "A Student");
    await deliver([event("11007", "2026-09-16 07:30:00")]);
    await h.db.db.update(rawEvents).set({ processedAt: null });

    const res = await h.app.server.inject({
      method: "GET",
      url: "/internal/process",
      headers: { authorization: `Bearer ${REPORT_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().envelopesProcessed).toBe(1);
  });
});

describe("describeError", () => {
  it("puts the database's own words first, with its code and detail", () => {
    const cause = Object.assign(new Error('column "x" is of type text'), {
      code: "42804",
      detail: "You will need to rewrite or cast the expression.",
    });
    const wrapped = new Error(
      'Failed query: insert into "t" values ($1)\nparams: 20',
      { cause },
    );
    expect(describeError(wrapped)).toBe(
      'column "x" is of type text [42804] You will need to rewrite or cast the expression. — Failed query: insert into "t" values ($1)',
    );
  });

  it("leaves an error without a cause alone", () => {
    expect(describeError(new Error("plain"))).toBe("plain");
    expect(describeError("not an error")).toBe("not an error");
  });
});
