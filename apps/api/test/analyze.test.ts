import { describe, expect, it } from "vitest";
import {
  analyze,
  parseAttTimeAsUtc,
  percentiles,
  type RawEventInput,
} from "../src/discovery/analyze.js";

/** Builds a raw_events row the way the ingest handler would, minus I/O. */
function delivery(
  id: number,
  receivedAt: string,
  events: unknown[] | null,
  extra: Partial<RawEventInput> = {},
): RawEventInput {
  return {
    id,
    receivedAt: new Date(receivedAt),
    remoteIp: "203.0.113.10",
    method: "POST",
    headers: {
      host: "ams.example",
      "content-type": "application/json",
      "content-length": "123",
    },
    contentType: "application/json",
    bodyBytes: 123,
    bodyJson: events,
    batchSize: events === null ? null : events.length,
    parseError: null,
    ...extra,
  };
}

function ev(
  empId: string,
  attTime: string,
  status: string,
  device = "CLXK221260271",
  verifyKey = "VerifyType",
) {
  return {
    EmpId: empId,
    AttTime: attTime,
    CheckingStatus: status,
    [verifyKey]: "1",
    DeviceID: device,
  };
}

describe("parseAttTimeAsUtc", () => {
  it("parses the vendor format as UTC", () => {
    expect(parseAttTimeAsUtc("2024-01-08 16:58:03")).toBe(
      Date.UTC(2024, 0, 8, 16, 58, 3),
    );
  });
  it("rejects anything else", () => {
    expect(parseAttTimeAsUtc("2024-01-08T16:58:03Z")).toBeNull();
    expect(parseAttTimeAsUtc("08/01/2024 16:58")).toBeNull();
    expect(parseAttTimeAsUtc("")).toBeNull();
  });
});

describe("percentiles", () => {
  it("returns null on no samples", () => {
    expect(percentiles([])).toBeNull();
  });
  it("computes order statistics", () => {
    const p = percentiles([5, 1, 3, 2, 4]);
    expect(p).toEqual({
      samples: 5,
      min: 1,
      p10: 1,
      median: 3,
      p90: 4,
      max: 5,
    });
  });
});

describe("analyze — empty", () => {
  it("produces a complete report with zero counts", () => {
    const r = analyze([]);
    expect(r.totals.deliveries).toBe(0);
    expect(r.totals.events).toBe(0);
    expect(r.keys).toEqual([]);
    expect(r.attTime.offsetMinutes).toBeNull();
    expect(r.batches.sizes).toBeNull();
    expect(r.interArrivalSeconds.stats).toBeNull();
    expect(r.redelivery.tuplesSeenMoreThanOnce).toBe(0);
    expect(r.verifyType.verdict).toMatch(/No verify-type key/);
  });
});

describe("analyze — field names (unknown #1)", () => {
  it("reports every key with exact casing and counts", () => {
    const r = analyze([
      delivery(1, "2024-01-08T11:30:00Z", [
        ev("20", "2024-01-08 16:58:03", "0", "D1", "VerifyType"),
        ev("21", "2024-01-08 16:58:04", "0", "D1", "VeryfyType"),
      ]),
    ]);
    const keys = Object.fromEntries(r.keys.map((k) => [k.value, k.count]));
    expect(keys).toEqual({
      EmpId: 2,
      AttTime: 2,
      CheckingStatus: 2,
      DeviceID: 2,
      VerifyType: 1,
      VeryfyType: 1,
    });
    expect(r.verifyType.keyCandidates.map((c) => c.value).sort()).toEqual([
      "VerifyType",
      "VeryfyType",
    ]);
    expect(r.verifyType.verdict).toMatch(/Multiple spellings/);
  });

  it("gives a single-spelling verdict when only one is seen", () => {
    const r = analyze([
      delivery(1, "2024-01-08T11:30:00Z", [
        ev("20", "2024-01-08 16:58:03", "0"),
      ]),
    ]);
    expect(r.verifyType.verdict).toMatch(/exactly "VerifyType"/);
    expect(r.verifyType.values).toEqual([{ value: "1", count: 1 }]);
  });
});

describe("analyze — timezone (unknown #2)", () => {
  it("detects Sri Lanka local time from a +5:30 offset", () => {
    // 08:00 local Colombo = 02:30 UTC; delivered 20 seconds later.
    const r = analyze([
      delivery(1, "2024-01-08T02:30:20Z", [
        ev("1", "2024-01-08 08:00:00", "0"),
      ]),
      delivery(2, "2024-01-08T02:31:10Z", [
        ev("2", "2024-01-08 08:01:00", "0"),
      ]),
    ]);
    expect(r.attTime.offsetMinutes?.median).toBeCloseTo(329.7, 0);
    expect(r.attTime.verdict).toMatch(/Asia\/Colombo/);
    expect(r.attTime.hourOfDayHistogram.find((h) => h.value === 8)?.count).toBe(
      2,
    );
  });

  it("detects UTC when the offset clusters at zero", () => {
    const r = analyze([
      delivery(1, "2024-01-08T02:30:20Z", [
        ev("1", "2024-01-08 02:30:00", "0"),
      ]),
    ]);
    expect(r.attTime.verdict).toMatch(/AttTime is UTC/);
  });

  it("counts AttTime values that do not match the documented format", () => {
    const r = analyze([
      delivery(1, "2024-01-08T02:30:20Z", [
        {
          EmpId: "1",
          AttTime: "2024-01-08T02:30:00Z",
          CheckingStatus: "0",
          DeviceID: "D",
        },
        ev("2", "2024-01-08 02:30:00", "0"),
      ]),
    ]);
    expect(r.attTime.format.matchingPattern).toBe(1);
    expect(r.attTime.format.notMatching).toBe(1);
    expect(r.attTime.format.examplesNotMatching).toEqual([
      "2024-01-08T02:30:00Z",
    ]);
  });
});

describe("analyze — CheckingStatus per device (unknown #3)", () => {
  it("flags a device that only ever emits one value", () => {
    const r = analyze([
      delivery(1, "2024-01-08T02:30:00Z", [
        ev("1", "2024-01-08 08:00:00", "0", "GATE"),
        ev("1", "2024-01-08 14:00:00", "0", "GATE"),
        ev("2", "2024-01-08 08:05:00", "0", "GATE"),
      ]),
    ]);
    const d = r.checkingStatusByDevice[0]!;
    expect(d.device).toBe("GATE");
    expect(d.statusValues).toEqual([{ value: "0", count: 3 }]);
    expect(d.personPairs).toBe(1);
    expect(d.pairsWithDifferentStatus).toBe(0);
    expect(d.verdict).toMatch(/single CheckingStatus value/);
    expect(d.scansPerPersonPerDay).toEqual([
      { value: "1", count: 1 },
      { value: "2", count: 1 },
      { value: "3", count: 0 },
      { value: "4+", count: 0 },
    ]);
  });

  it("recognises the vendor same-second artefact", () => {
    // The sample JSON from the vendor documentation, verbatim.
    const r = analyze([
      delivery(1, "2024-01-08T11:30:00Z", [
        ev("20", "2024-01-08 16:58:03", "0"),
        ev("20", "2024-01-08 16:58:03", "1"),
        ev("24", "2024-01-09 16:58:03", "0"),
      ]),
    ]);
    const d = r.checkingStatusByDevice[0]!;
    expect(d.statusValues.map((s) => s.value).sort()).toEqual(["0", "1"]);
    expect(d.personPairs).toBe(1);
    expect(d.pairsWithDifferentStatus).toBe(1);
    expect(d.sameSecondDifferentStatus).toBe(1);
    expect(d.verdict).toMatch(/vendor artefact/);
  });

  it("recognises a genuinely alternating flag", () => {
    const r = analyze([
      delivery(1, "2024-01-08T02:30:00Z", [
        ev("1", "2024-01-08 08:00:00", "0", "BOTH"),
        ev("1", "2024-01-08 14:00:00", "1", "BOTH"),
        ev("2", "2024-01-08 08:05:00", "0", "BOTH"),
        ev("2", "2024-01-08 14:05:00", "1", "BOTH"),
        ev("2", "2024-01-08 15:05:00", "0", "BOTH"),
      ]),
    ]);
    const d = r.checkingStatusByDevice[0]!;
    expect(d.personPairs).toBe(3);
    expect(d.pairsWithDifferentStatus).toBe(3);
    expect(d.sameSecondDifferentStatus).toBe(0);
    expect(d.verdict).toMatch(/plausibly a real in\/out indicator/);
  });

  it("orders a person's scans by AttTime, not by arrival", () => {
    // Out-of-order delivery: the later scan arrives first.
    const r = analyze([
      delivery(1, "2024-01-08T02:30:00Z", [
        ev("1", "2024-01-08 14:00:00", "1", "BOTH"),
        ev("1", "2024-01-08 08:00:00", "0", "BOTH"),
      ]),
    ]);
    expect(r.checkingStatusByDevice[0]!.pairsWithDifferentStatus).toBe(1);
    expect(r.outOfOrderDeliveries).toBe(1);
  });
});

describe("analyze — batches and arrival (unknown #4)", () => {
  it("builds the batch size histogram and inter-arrival stats", () => {
    const r = analyze([
      delivery(1, "2024-01-08T02:30:00Z", [
        ev("1", "2024-01-08 08:00:00", "0"),
      ]),
      delivery(2, "2024-01-08T02:30:30Z", [
        ev("2", "2024-01-08 08:00:20", "0"),
        ev("3", "2024-01-08 08:00:25", "0"),
      ]),
      delivery(3, "2024-01-08T02:34:30Z", [
        ev("4", "2024-01-08 08:04:00", "0"),
      ]),
    ]);
    expect(r.batches.histogram).toEqual([
      { value: 1, count: 2 },
      { value: 2, count: 1 },
    ]);
    expect(r.batches.sizes?.max).toBe(2);
    expect(r.interArrivalSeconds.stats).toMatchObject({
      samples: 2,
      min: 30,
      max: 240,
    });
    expect(r.interArrivalSeconds.histogram).toEqual([
      { value: "10-60s", count: 1 },
      { value: "1-5min", count: 1 },
    ]);
  });

  it("sorts deliveries by received time before computing gaps", () => {
    const r = analyze([
      delivery(2, "2024-01-08T02:31:00Z", [
        ev("1", "2024-01-08 08:01:00", "0"),
      ]),
      delivery(1, "2024-01-08T02:30:00Z", [
        ev("1", "2024-01-08 08:00:00", "0"),
      ]),
    ]);
    expect(r.interArrivalSeconds.stats?.min).toBe(60);
    expect(r.window.firstReceivedAt).toBe("2024-01-08T02:30:00.000Z");
  });
});

describe("analyze — redelivery (unknown #5)", () => {
  it("separates the vendor artefact from true redelivery", () => {
    const r = analyze([
      delivery(1, "2024-01-08T11:30:00Z", [
        ev("20", "2024-01-08 16:58:03", "0"),
        ev("20", "2024-01-08 16:58:03", "1"),
      ]),
    ]);
    expect(r.redelivery.tuplesSeenMoreThanOnce).toBe(1);
    expect(r.redelivery.eventsInRepeatedTuples).toBe(2);
    expect(r.redelivery.exactRepeatsIncludingStatus).toBe(0);
    expect(r.redelivery.verdict).toMatch(/two-rows-per-tap artefact/);
  });

  it("detects redelivery across separate deliveries", () => {
    const e = ev("20", "2024-01-08 16:58:03", "0");
    const r = analyze([
      delivery(1, "2024-01-08T11:30:00Z", [e]),
      delivery(2, "2024-01-08T11:31:00Z", [e]),
    ]);
    expect(r.redelivery.exactRepeatsIncludingStatus).toBe(1);
    expect(r.redelivery.repeatsAcrossDeliveries).toBe(1);
    expect(r.redelivery.repeatsWithinOneDelivery).toBe(0);
    expect(r.redelivery.verdict).toMatch(/platform redelivers/);
  });

  it("detects duplicates inside one delivery", () => {
    const e = ev("20", "2024-01-08 16:58:03", "0");
    const r = analyze([delivery(1, "2024-01-08T11:30:00Z", [e, e])]);
    expect(r.redelivery.repeatsWithinOneDelivery).toBe(1);
    expect(r.redelivery.verdict).toMatch(/within single deliveries/);
  });
});

describe("analyze — headers and source (unknowns #6, #7, #8)", () => {
  it("lists headers, flags credential-looking ones first, and counts IPs and content types", () => {
    const r = analyze([
      delivery(
        1,
        "2024-01-08T02:30:00Z",
        [ev("1", "2024-01-08 08:00:00", "0")],
        {
          headers: {
            host: "ams.example",
            "content-type": "application/json",
            "x-adms-signature": "8f3c2a1b9d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a",
            "user-agent": "okhttp/4.9",
          },
          remoteIp: "203.0.113.10",
        },
      ),
      delivery(2, "2024-01-08T02:31:00Z", null, {
        headers: { host: "ams.example", "content-type": "text/plain" },
        contentType: "text/plain",
        remoteIp: "203.0.113.11",
        parseError: "JSON parse failed: Unexpected token",
      }),
    ]);
    expect(r.headers[0]).toMatchObject({
      name: "x-adms-signature",
      count: 1,
      looksLikeToken: true,
    });
    expect(r.headers.find((h) => h.name === "host")).toMatchObject({
      count: 2,
      looksLikeToken: false,
      examples: ["ams.example"],
    });
    expect(r.sourceIps).toEqual([
      { value: "203.0.113.10", count: 1 },
      { value: "203.0.113.11", count: 1 },
    ]);
    expect(r.contentTypes).toEqual([
      { value: "application/json", count: 1 },
      { value: "text/plain", count: 1 },
    ]);
    expect(r.parseErrors).toEqual([
      { value: "JSON parse failed: Unexpected token", count: 1 },
    ]);
    expect(r.totals.deliveriesWithParseError).toBe(1);
  });

  it("counts oversize discards", () => {
    const r = analyze([
      delivery(1, "2024-01-08T02:30:00Z", null, {
        parseError: "body exceeded 1048576 byte cap; discarded",
      }),
    ]);
    expect(r.totals.deliveriesOversize).toBe(1);
  });
});

describe("analyze — totals, devices, overlap", () => {
  it("counts distinct EmpIds and devices and finds cross-device EmpIds", () => {
    const r = analyze([
      delivery(1, "2024-01-08T02:30:00Z", [
        ev("1", "2024-01-08 08:00:00", "0", "A"),
        ev("1", "2024-01-08 14:00:00", "0", "B"),
        ev("2", "2024-01-08 08:00:00", "0", "A"),
        "not-an-object",
      ]),
    ]);
    expect(r.totals.events).toBe(4);
    expect(r.totals.nonObjectEvents).toBe(1);
    expect(r.totals.distinctEmpIds).toBe(2);
    expect(r.totals.distinctDevices).toBe(2);
    expect(r.devices.map((d) => d.serial)).toEqual(["A", "B", "(none)"]);
    expect(r.devices[0]).toMatchObject({
      events: 2,
      distinctEmpIds: 2,
      firstAttTime: "2024-01-08 08:00:00",
    });
    expect(r.empIdDeviceOverlap).toEqual({
      empIdsOnMultipleDevices: 1,
      examples: [{ empId: "1", devices: ["A", "B"] }],
    });
  });

  it("tolerates numeric field values", () => {
    const r = analyze([
      delivery(1, "2024-01-08T02:30:00Z", [
        {
          EmpId: 20,
          AttTime: "2024-01-08 08:00:00",
          CheckingStatus: 0,
          DeviceID: "A",
        },
      ]),
    ]);
    expect(r.totals.distinctEmpIds).toBe(1);
    expect(r.checkingStatusByDevice[0]!.statusValues).toEqual([
      { value: "0", count: 1 },
    ]);
  });
});
