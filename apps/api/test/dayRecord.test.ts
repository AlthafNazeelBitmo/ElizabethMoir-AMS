import { describe, expect, it } from "vitest";
import {
  computeDayRecord,
  type DayContext,
  type DayScan,
} from "../src/domain/dayRecord.js";
import type { Direction } from "../src/db/schema/index.js";

/** 2026-09-16, Colombo: 08:00 local is 02:30 UTC. */
const utc = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 16, h, m, 0));
const LATE_THRESHOLD = utc(2, 30); // 08:00 local
const DAY_STARTED = utc(3, 0); // 08:30 local
const AFTERNOON = utc(9, 0); // 14:30 local

const scan = (
  h: number,
  direction: Direction,
  isDuplicate = false,
): DayScan => ({
  attTime: utc(h),
  direction,
  isDuplicate,
});

function ctx(overrides: Partial<DayContext> = {}): DayContext {
  return {
    expectsAttendance: true,
    isSchoolDay: true,
    lateThreshold: LATE_THRESHOLD,
    leaveCutoff: null,
    absenceDecidedFrom: DAY_STARTED,
    now: AFTERNOON,
    ...overrides,
  };
}

describe("leaving early", () => {
  const CUTOFF = utc(9, 30); // 15:00 local

  it("is a departure before the group's cut-off", () => {
    const r = computeDayRecord(
      [scan(2, "in"), scan(8, "out")],
      ctx({ leaveCutoff: CUTOFF }),
    );
    expect(r?.status).toBe("departed");
    expect(r?.leftEarly).toBe(true);
  });

  it("is not a departure after it", () => {
    const r = computeDayRecord(
      [scan(2, "in"), scan(10, "out")],
      ctx({ leaveCutoff: CUTOFF }),
    );
    expect(r?.leftEarly).toBe(false);
  });

  it("is nothing for someone who has not left", () => {
    const r = computeDayRecord([scan(2, "in")], ctx({ leaveCutoff: CUTOFF }));
    expect(r?.status).toBe("on_site");
    expect(r?.leftEarly).toBe(false);
  });

  it("is nothing where the group sets no cut-off", () => {
    // Most groups. A time nobody has given cannot be broken.
    const r = computeDayRecord([scan(2, "in"), scan(4, "out")], ctx());
    expect(r?.leftEarly).toBe(false);
  });

  it("goes by the last departure, not a trip out at lunch", () => {
    const r = computeDayRecord(
      [scan(2, "in"), scan(5, "out"), scan(6, "in"), scan(10, "out")],
      ctx({ leaveCutoff: CUTOFF }),
    );
    expect(r?.leftEarly).toBe(false);
  });
});

describe("last movement", () => {
  it("is the last scan that counted, in or out", () => {
    const r = computeDayRecord([scan(2, "in"), scan(9, "out")], ctx());
    expect(r?.lastMovementAt).toEqual(utc(9));
  });

  it("is the return, which first_in and last_out between them do not say", () => {
    // Out at lunch and back: last_out is cleared by the return, first_in
    // is the morning. The movement is the return.
    const r = computeDayRecord(
      [scan(2, "in"), scan(6, "out"), scan(7, "in")],
      ctx(),
    );
    expect(r?.lastOut).toBeNull();
    expect(r?.lastMovementAt).toEqual(utc(7));
  });

  it("is not moved by a duplicate tap", () => {
    const r = computeDayRecord(
      [scan(2, "in"), scan(3, "in", true)],
      ctx(),
    );
    expect(r?.lastMovementAt).toEqual(utc(2));
  });

  it("is nothing for someone who was not seen", () => {
    const r = computeDayRecord([], ctx());
    expect(r?.status).toBe("absent");
    expect(r?.lastMovementAt).toBeNull();
  });

  it("is kept on a day nobody was expected, as the times are", () => {
    const r = computeDayRecord([scan(2, "in")], ctx({ isSchoolDay: false }));
    expect(r?.lastMovementAt).toEqual(utc(2));
  });
});

describe("not_expected", () => {
  it("applies to a group that does not expect attendance, such as contractors", () => {
    const r = computeDayRecord(
      [scan(2, "in")],
      ctx({ expectsAttendance: false }),
    );
    expect(r?.status).toBe("not_expected");
    expect(r?.isLate).toBe(false);
  });

  it("applies to a date that is not a school day", () => {
    const r = computeDayRecord([], ctx({ isSchoolDay: false }));
    expect(r?.status).toBe("not_expected");
  });

  it("still records the times, so a weekend visit is visible if anyone looks", () => {
    const r = computeDayRecord(
      [scan(2, "in"), scan(9, "out")],
      ctx({ isSchoolDay: false }),
    );
    expect(r?.firstIn).toEqual(utc(2));
    expect(r?.lastOut).toEqual(utc(9));
    expect(r?.scanCount).toBe(2);
  });

  it("is never late, even arriving after the threshold", () => {
    const r = computeDayRecord(
      [scan(5, "in")],
      ctx({ expectsAttendance: false }),
    );
    expect(r?.isLate).toBe(false);
  });
});

describe("absent", () => {
  it("applies to an expected person with no scans, once the day has started", () => {
    const r = computeDayRecord([], ctx());
    expect(r?.status).toBe("absent");
    expect(r?.scanCount).toBe(0);
  });

  it("is not decided before the day has started: no record at all", () => {
    // This is what stops a nightly job marking the whole school absent at midnight.
    const r = computeDayRecord([], ctx({ now: utc(0) }));
    expect(r).toBeNull();
  });

  it("is decided exactly at the deciding moment", () => {
    expect(computeDayRecord([], ctx({ now: DAY_STARTED }))?.status).toBe(
      "absent",
    );
    expect(
      computeDayRecord([], ctx({ now: new Date(DAY_STARTED.getTime() - 1) })),
    ).toBeNull();
  });
});

describe("on_site", () => {
  it("applies after an arrival with no departure", () => {
    const r = computeDayRecord([scan(2, "in")], ctx());
    expect(r?.status).toBe("on_site");
    expect(r?.firstIn).toEqual(utc(2));
    expect(r?.lastOut).toBeNull();
  });

  it("applies when an odd number of movements leaves them inside", () => {
    const r = computeDayRecord(
      [scan(2, "in"), scan(5, "out"), scan(6, "in")],
      ctx(),
    );
    expect(r?.status).toBe("on_site");
    expect(r?.lastOut).toBeNull();
  });

  it("keeps the earliest arrival as first_in", () => {
    const r = computeDayRecord([scan(2, "in"), scan(6, "in")], ctx());
    expect(r?.firstIn).toEqual(utc(2));
  });
});

describe("departed", () => {
  it("applies after an arrival and a later departure", () => {
    const r = computeDayRecord([scan(2, "in"), scan(9, "out")], ctx());
    expect(r?.status).toBe("departed");
    expect(r?.firstIn).toEqual(utc(2));
    expect(r?.lastOut).toEqual(utc(9));
  });

  it("uses the latest departure", () => {
    const r = computeDayRecord(
      [scan(2, "in"), scan(5, "out"), scan(6, "in"), scan(9, "out")],
      ctx(),
    );
    expect(r?.status).toBe("departed");
    expect(r?.lastOut).toEqual(utc(9));
  });

  it("does not count a departure that an arrival follows", () => {
    // Out at lunch, back afterwards: on site, not departed.
    const r = computeDayRecord(
      [scan(2, "in"), scan(5, "out"), scan(6, "in")],
      ctx(),
    );
    expect(r?.status).toBe("on_site");
    expect(r?.lastOut).toBeNull();
  });

  it("ignores a departure with no arrival before it", () => {
    const r = computeDayRecord([scan(5, "out")], ctx());
    expect(r?.firstIn).toBeNull();
    expect(r?.lastOut).toBeNull();
  });
});

describe("late", () => {
  it("is a separate flag that combines with on_site", () => {
    const r = computeDayRecord([scan(5, "in")], ctx());
    expect(r?.status).toBe("on_site");
    expect(r?.isLate).toBe(true);
  });

  it("combines with departed too", () => {
    const r = computeDayRecord([scan(5, "in"), scan(9, "out")], ctx());
    expect(r?.status).toBe("departed");
    expect(r?.isLate).toBe(true);
  });

  it("is judged on the first arrival, not a later one", () => {
    const r = computeDayRecord([scan(2, "in"), scan(5, "in")], ctx());
    expect(r?.isLate).toBe(false);
  });

  it("is not late exactly on the threshold", () => {
    const r = computeDayRecord(
      [{ attTime: LATE_THRESHOLD, direction: "in", isDuplicate: false }],
      ctx(),
    );
    expect(r?.isLate).toBe(false);
  });

  it("is never late when no threshold is configured", () => {
    const r = computeDayRecord([scan(9, "in")], ctx({ lateThreshold: null }));
    expect(r?.isLate).toBe(false);
  });
});

describe("duplicates and unknowns", () => {
  it("counts a duplicate in scan_count but ignores it for the times", () => {
    const r = computeDayRecord(
      [scan(2, "in"), { attTime: utc(2), direction: "in", isDuplicate: true }],
      ctx(),
    );
    expect(r?.scanCount).toBe(2);
    expect(r?.status).toBe("on_site");
  });

  it("counts unknown-direction scans and reports them as a data-quality signal", () => {
    const r = computeDayRecord([scan(2, "in"), scan(5, "unknown")], ctx());
    expect(r?.scanCount).toBe(2);
    expect(r?.unknownDirectionCount).toBe(1);
  });

  it("excludes unknown scans from first_in and last_out", () => {
    const r = computeDayRecord([scan(1, "unknown"), scan(2, "in")], ctx());
    expect(r?.firstIn).toEqual(utc(2));
  });

  it("treats someone with only undecidable scans as present, not absent", () => {
    // They were at the gate. Reporting a child missing when the evidence says
    // otherwise is the dangerous direction to be wrong in.
    const r = computeDayRecord([scan(2, "unknown")], ctx());
    expect(r?.status).toBe("on_site");
    expect(r?.status).not.toBe("absent");
    expect(r?.unknownDirectionCount).toBe(1);
  });
});

describe("ordering", () => {
  it("does not depend on the order scans are supplied in", () => {
    const forwards = computeDayRecord(
      [scan(2, "in"), scan(5, "out"), scan(9, "in")],
      ctx(),
    );
    const backwards = computeDayRecord(
      [scan(9, "in"), scan(5, "out"), scan(2, "in")],
      ctx(),
    );
    expect(backwards).toEqual(forwards);
  });
});
