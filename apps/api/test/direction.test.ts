import { describe, expect, it } from "vitest";
import { dedupeKey } from "../src/domain/dedupe.js";
import {
  parseStatusMap,
  resolveDayDirections,
  type DayScanInput,
  type DeviceConfig,
  type DirectionContext,
} from "../src/domain/direction.js";

const GATE = "TEST000000001";
const ENTRY_DOOR = "ENTRY-1";
const EXIT_DOOR = "EXIT-1";

function ctx(overrides: Partial<DirectionContext> = {}): DirectionContext {
  const devices = new Map<string, DeviceConfig>([
    [GATE, { direction: "both", trustCheckingStatus: false }],
    [ENTRY_DOOR, { direction: "entry", trustCheckingStatus: false }],
    [EXIT_DOOR, { direction: "exit", trustCheckingStatus: false }],
  ]);
  return { devices, statusMap: {}, duplicateWindowSeconds: 60, ...overrides };
}

const at = (
  hhmm: string,
  device = GATE,
  checkingStatus: string | null = "0",
): DayScanInput => {
  const [h, m, s] = hhmm.split(":");
  return {
    attTime: new Date(
      Date.UTC(2026, 8, 16, Number(h), Number(m), Number(s ?? 0)),
    ),
    deviceSerial: device,
    checkingStatus,
  };
};

describe("rule 1 — device configuration", () => {
  it("uses the device's direction when it has one", () => {
    const r = resolveDayDirections(
      [at("08:00", ENTRY_DOOR), at("15:00", EXIT_DOOR)],
      ctx(),
    );
    expect(r[0]).toMatchObject({ direction: "in", directionSource: "device" });
    expect(r[1]).toMatchObject({ direction: "out", directionSource: "device" });
  });

  it("wins over the status flag even where the flag is trusted", () => {
    const r = resolveDayDirections(
      [at("08:00", ENTRY_DOOR, "1")],
      ctx({
        devices: new Map([
          [ENTRY_DOOR, { direction: "entry", trustCheckingStatus: true }],
        ]),
        statusMap: { "1": "out" },
      }),
    );
    expect(r[0]).toMatchObject({ direction: "in", directionSource: "device" });
  });

  it("does not alternate on a one-way device: two arrivals are both arrivals", () => {
    const r = resolveDayDirections(
      [at("08:00", ENTRY_DOOR), at("12:00", ENTRY_DOOR)],
      ctx(),
    );
    expect(r.map((x) => x.direction)).toEqual(["in", "in"]);
  });
});

describe("rule 2 — the CheckingStatus flag", () => {
  it("is ignored unless the device is explicitly trusted", () => {
    const r = resolveDayDirections(
      [at("08:00", GATE, "1")],
      ctx({ statusMap: { "1": "out" } }),
    );
    // Falls through to the sequence rule, which calls the first scan an arrival.
    expect(r[0]).toMatchObject({
      direction: "in",
      directionSource: "sequence",
    });
  });

  it("is used when the device is trusted and the value is mapped", () => {
    const trusted = ctx({
      devices: new Map([
        [GATE, { direction: "both", trustCheckingStatus: true }],
      ]),
      statusMap: { "0": "in", "1": "out" },
    });
    const r = resolveDayDirections(
      [at("08:00", GATE, "1"), at("15:00", GATE, "0")],
      trusted,
    );
    expect(r[0]).toMatchObject({ direction: "out", directionSource: "status" });
    expect(r[1]).toMatchObject({ direction: "in", directionSource: "status" });
  });

  it("falls through when the value is trusted but unmapped", () => {
    const trusted = ctx({
      devices: new Map([
        [GATE, { direction: "both", trustCheckingStatus: true }],
      ]),
      statusMap: { "0": "in" },
    });
    const r = resolveDayDirections([at("08:00", GATE, "7")], trusted);
    expect(r[0]!.directionSource).toBe("sequence");
  });
});

describe("rule 3 — alternation", () => {
  it("makes the first scan an arrival and alternates after it", () => {
    const r = resolveDayDirections(
      [at("07:30"), at("12:00"), at("13:00"), at("15:30")],
      ctx(),
    );
    expect(r.map((x) => x.direction)).toEqual(["in", "out", "in", "out"]);
    expect(r.every((x) => x.directionSource === "sequence")).toBe(true);
  });

  it("leaves an odd number of scans on site", () => {
    const r = resolveDayDirections(
      [at("07:30"), at("12:00"), at("13:00")],
      ctx(),
    );
    expect(r.at(-1)!.direction).toBe("in");
  });

  it("orders by time, not by arrival in the batch", () => {
    // The later scan is delivered first; the earlier one is still the arrival.
    const r = resolveDayDirections([at("15:30"), at("07:30")], ctx());
    expect(r[0]!.direction).toBe("out");
    expect(r[1]!.direction).toBe("in");
  });

  it("treats a device it has never seen as bidirectional", () => {
    const r = resolveDayDirections(
      [at("07:30", "BRAND-NEW"), at("15:30", "BRAND-NEW")],
      ctx(),
    );
    expect(r.map((x) => x.direction)).toEqual(["in", "out"]);
  });
});

describe("duplicate suppression", () => {
  it("collapses a second tap on the same device inside the window", () => {
    const r = resolveDayDirections([at("07:30:00"), at("07:30:20")], ctx());
    expect(r[0]).toMatchObject({ direction: "in", isDuplicate: false });
    expect(r[1]).toMatchObject({ direction: "in", isDuplicate: true });
  });

  it("does not let a repeat tap flip the alternation", () => {
    // Tap, tap again immediately, then leave at lunch.
    const r = resolveDayDirections(
      [at("07:30:00"), at("07:30:05"), at("12:00:00")],
      ctx(),
    );
    expect(r.map((x) => x.direction)).toEqual(["in", "in", "out"]);
  });

  it("treats a tap after the window as a real movement", () => {
    const r = resolveDayDirections([at("07:30:00"), at("07:31:30")], ctx());
    expect(r[1]).toMatchObject({ direction: "out", isDuplicate: false });
  });

  it("measures the window from the movement, not from the last repeat", () => {
    // Tap, fumble a second tap fifty seconds on, then walk out fifty
    // seconds after that. The third tap is a hundred seconds after the
    // arrival: a movement, not a third copy of it.
    const r = resolveDayDirections(
      [at("07:30:00"), at("07:30:50"), at("07:31:40")],
      ctx(),
    );
    expect(r.map((x) => x.isDuplicate)).toEqual([false, true, false]);
    expect(r.map((x) => x.direction)).toEqual(["in", "in", "out"]);
  });

  it("does not let a run of taps become one endless movement", () => {
    // Someone testing a reader: in and out every forty-five seconds.
    const r = resolveDayDirections(
      [
        at("07:30:00"),
        at("07:30:45"),
        at("07:31:30"),
        at("07:32:15"),
        at("07:33:00"),
      ],
      ctx(),
    );
    expect(r.map((x) => x.isDuplicate)).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(r.map((x) => x.direction)).toEqual(["in", "in", "out", "out", "in"]);
  });

  it("respects a configured window length", () => {
    const wide = ctx({ duplicateWindowSeconds: 300 });
    const r = resolveDayDirections([at("07:30:00"), at("07:33:00")], wide);
    expect(r[1]!.isDuplicate).toBe(true);
  });

  it("does not collapse taps on different devices", () => {
    const r = resolveDayDirections(
      [at("07:30:00", GATE), at("07:30:10", "OTHER")],
      ctx(),
    );
    expect(r[1]!.isDuplicate).toBe(false);
  });

  it("handles the vendor's same-second pair as one movement", () => {
    // The sample payload: same person, same second, same device, statuses 0 and 1.
    const r = resolveDayDirections(
      [at("16:58:03", GATE, "0"), at("16:58:03", GATE, "1")],
      ctx(),
    );
    expect(r[1]!.isDuplicate).toBe(true);
    expect(r[0]!.direction).toBe(r[1]!.direction);
  });
});

describe("rule 4 — undecidable", () => {
  it("records unknown rather than guessing on a one-way-but-unspecified device", () => {
    const odd = ctx({
      devices: new Map([
        [GATE, { direction: "weird" as never, trustCheckingStatus: false }],
      ]),
    });
    const r = resolveDayDirections([at("08:00")], odd);
    expect(r[0]!.direction).toBe("unknown");
  });

  it("does not advance the alternation past an unknown", () => {
    const odd = ctx({
      devices: new Map([
        [GATE, { direction: "both", trustCheckingStatus: false }],
        [
          "MYSTERY",
          { direction: "weird" as never, trustCheckingStatus: false },
        ],
      ]),
    });
    const r = resolveDayDirections(
      [at("08:00", "MYSTERY"), at("09:00", GATE)],
      odd,
    );
    expect(r[0]!.direction).toBe("unknown");
    // The first real movement is still an arrival.
    expect(r[1]!.direction).toBe("in");
  });
});

describe("parseStatusMap", () => {
  it("keeps valid directions and drops everything else", () => {
    expect(
      parseStatusMap({ "0": "in", "1": "out", "2": "sideways", "3": 7 }),
    ).toEqual({
      "0": "in",
      "1": "out",
    });
  });

  it("tolerates junk from settings", () => {
    for (const junk of [null, undefined, [], "in", 42]) {
      expect(parseStatusMap(junk)).toEqual({});
    }
  });
});

describe("dedupeKey", () => {
  const base = {
    enrollNo: "20",
    attTimeLocal: "2024-01-08 16:58:03",
    deviceSerial: "CLXK221260271",
    checkingStatus: "0",
  };

  it("is stable for the same scan", () => {
    expect(dedupeKey(base)).toBe(dedupeKey({ ...base }));
    expect(dedupeKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when any component differs", () => {
    expect(dedupeKey({ ...base, enrollNo: "21" })).not.toBe(dedupeKey(base));
    expect(
      dedupeKey({ ...base, attTimeLocal: "2024-01-08 16:58:04" }),
    ).not.toBe(dedupeKey(base));
    expect(dedupeKey({ ...base, deviceSerial: "OTHER" })).not.toBe(
      dedupeKey(base),
    );
    expect(dedupeKey({ ...base, checkingStatus: "1" })).not.toBe(
      dedupeKey(base),
    );
  });

  it("preserves the vendor's same-second pair as two distinct scans", () => {
    expect(dedupeKey({ ...base, checkingStatus: "0" })).not.toBe(
      dedupeKey({ ...base, checkingStatus: "1" }),
    );
  });

  it("treats a missing status as distinct from an empty one being absent", () => {
    // Both collapse to the same material; documented rather than accidental.
    expect(dedupeKey({ ...base, checkingStatus: null })).toBe(
      dedupeKey({ ...base, checkingStatus: "" }),
    );
  });

  it("cannot be confused by a separator appearing inside a field", () => {
    const a = dedupeKey({ ...base, enrollNo: "20|2024-01-08 16:58:03" });
    expect(a).not.toBe(dedupeKey(base));
  });
});
