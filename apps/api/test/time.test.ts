import { describe, expect, it } from "vitest";
import {
  formatNaiveLocal,
  instantAtLocalTime,
  isValidTimeZone,
  localToUtc,
  offsetMinutesAt,
  parseNaiveLocal,
  parseTimeOfDay,
  schoolDayFor,
  utcToLocal,
} from "../src/domain/time.js";

const COLOMBO = "Asia/Colombo";
const LONDON = "Europe/London"; // has daylight saving; Colombo does not

describe("parseNaiveLocal", () => {
  it("parses the vendor's format", () => {
    expect(parseNaiveLocal("2024-01-08 16:58:03")).toEqual({
      year: 2024,
      month: 1,
      day: 8,
      hour: 16,
      minute: 58,
      second: 3,
    });
  });

  it("rejects anything else", () => {
    for (const s of [
      "2024-01-08T16:58:03Z",
      "08/01/2024 16:58",
      "",
      "2024-1-8 16:58:03",
    ]) {
      expect(parseNaiveLocal(s), s).toBeNull();
    }
  });

  it("rejects dates that do not exist", () => {
    expect(parseNaiveLocal("2023-02-29 08:00:00")).toBeNull();
    expect(parseNaiveLocal("2024-04-31 08:00:00")).toBeNull();
    // A real leap day is fine.
    expect(parseNaiveLocal("2024-02-29 08:00:00")).not.toBeNull();
  });

  it("round-trips through formatNaiveLocal", () => {
    const s = "2026-09-17 07:05:09";
    expect(formatNaiveLocal(parseNaiveLocal(s)!)).toBe(s);
  });
});

describe("Asia/Colombo, which has no daylight saving", () => {
  it("is UTC+5:30 all year", () => {
    expect(offsetMinutesAt(new Date("2026-01-15T00:00:00Z"), COLOMBO)).toBe(
      330,
    );
    expect(offsetMinutesAt(new Date("2026-07-15T00:00:00Z"), COLOMBO)).toBe(
      330,
    );
  });

  it("converts a school arrival to the right instant", () => {
    // 07:28:42 in Colombo is 01:58:42 UTC.
    const utc = localToUtc(parseNaiveLocal("2026-09-16 07:28:42")!, COLOMBO);
    expect(utc.toISOString()).toBe("2026-09-16T01:58:42.000Z");
  });

  it("round-trips any instant through local and back", () => {
    for (const iso of [
      "2026-09-16T01:58:42.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-12-31T18:29:59.000Z",
    ]) {
      const instant = new Date(iso);
      expect(
        localToUtc(utcToLocal(instant, COLOMBO), COLOMBO).toISOString(),
      ).toBe(iso);
    }
  });
});

describe("a zone with daylight saving", () => {
  it("uses the offset in force at that moment, not a fixed one", () => {
    expect(offsetMinutesAt(new Date("2026-01-15T12:00:00Z"), LONDON)).toBe(0);
    expect(offsetMinutesAt(new Date("2026-07-15T12:00:00Z"), LONDON)).toBe(60);
  });

  it("converts summer and winter wall times correctly", () => {
    expect(
      localToUtc(parseNaiveLocal("2026-01-15 09:00:00")!, LONDON).toISOString(),
    ).toBe("2026-01-15T09:00:00.000Z");
    expect(
      localToUtc(parseNaiveLocal("2026-07-15 09:00:00")!, LONDON).toISOString(),
    ).toBe("2026-07-15T08:00:00.000Z");
  });

  it("resolves a spring-forward time that never existed to the instant the clock jumps to", () => {
    // In 2026 the UK clocks go forward at 01:00 on 29 March; 01:30 does not exist.
    const utc = localToUtc(parseNaiveLocal("2026-03-29 01:30:00")!, LONDON);
    expect(utc.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    // Which reads back as 02:30 local — after the gap, as intended.
    expect(utcToLocal(utc, LONDON).hour).toBe(2);
  });

  it("resolves an ambiguous autumn time to the earlier of the two instants", () => {
    // Clocks go back at 02:00 on 25 October 2026; 01:30 happens twice.
    const utc = localToUtc(parseNaiveLocal("2026-10-25 01:30:00")!, LONDON);
    expect(utc.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(utcToLocal(utc, LONDON).hour).toBe(1);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimeZone(COLOMBO)).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("+05:30")).toBe(false);
  });
});

describe("parseTimeOfDay", () => {
  it("accepts HH:mm and HH:mm:ss", () => {
    expect(parseTimeOfDay("08:00")).toEqual({ hour: 8, minute: 0, second: 0 });
    expect(parseTimeOfDay("03:15:30")).toEqual({
      hour: 3,
      minute: 15,
      second: 30,
    });
  });

  it("rejects impossible and malformed times", () => {
    for (const s of ["24:00", "08:60", "8", "", "08:0:0", "midnight"]) {
      expect(parseTimeOfDay(s), s).toBeNull();
    }
  });
});

describe("schoolDayFor", () => {
  const ROLLOVER = "03:00";

  it("assigns a normal school morning to that date", () => {
    const instant = localToUtc(
      parseNaiveLocal("2026-09-16 07:28:42")!,
      COLOMBO,
    );
    expect(schoolDayFor(instant, COLOMBO, ROLLOVER)).toBe("2026-09-16");
  });

  it("assigns a late evening to the same day", () => {
    const instant = localToUtc(
      parseNaiveLocal("2026-09-16 23:45:00")!,
      COLOMBO,
    );
    expect(schoolDayFor(instant, COLOMBO, ROLLOVER)).toBe("2026-09-16");
  });

  it("assigns the small hours to the day that is ending, not the one starting", () => {
    const instant = localToUtc(
      parseNaiveLocal("2026-09-17 01:30:00")!,
      COLOMBO,
    );
    expect(schoolDayFor(instant, COLOMBO, ROLLOVER)).toBe("2026-09-16");
  });

  it("switches over exactly at the rollover time", () => {
    const before = localToUtc(parseNaiveLocal("2026-09-17 02:59:59")!, COLOMBO);
    const after = localToUtc(parseNaiveLocal("2026-09-17 03:00:00")!, COLOMBO);
    expect(schoolDayFor(before, COLOMBO, ROLLOVER)).toBe("2026-09-16");
    expect(schoolDayFor(after, COLOMBO, ROLLOVER)).toBe("2026-09-17");
  });

  it("crosses a month and a year boundary correctly", () => {
    const newYear = localToUtc(
      parseNaiveLocal("2027-01-01 01:00:00")!,
      COLOMBO,
    );
    expect(schoolDayFor(newYear, COLOMBO, ROLLOVER)).toBe("2026-12-31");
  });

  it("treats a rollover of 00:00 as no rollover at all", () => {
    const instant = localToUtc(
      parseNaiveLocal("2026-09-17 01:30:00")!,
      COLOMBO,
    );
    expect(schoolDayFor(instant, COLOMBO, "00:00")).toBe("2026-09-17");
  });
});

describe("instantAtLocalTime", () => {
  it("finds the instant a threshold falls at on a given date", () => {
    const eight = instantAtLocalTime(
      "2026-09-16",
      { hour: 8, minute: 0, second: 0 },
      COLOMBO,
    );
    expect(eight?.toISOString()).toBe("2026-09-16T02:30:00.000Z");
  });

  it("returns null for a malformed date", () => {
    expect(
      instantAtLocalTime(
        "16/09/2026",
        { hour: 8, minute: 0, second: 0 },
        COLOMBO,
      ),
    ).toBeNull();
  });
});
