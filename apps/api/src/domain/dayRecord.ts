import type { DayStatus, Direction } from "../db/schema/index.js";

/**
 * Deriving one person's state on one day from their scans.
 *
 * Pure, and deliberately so: this is the calculation every figure the school
 * sees rests on, and it must be testable against every edge case without a
 * database, a clock, or a request.
 */

export interface DayScan {
  attTime: Date;
  direction: Direction;
  /** A repeat tap. Counted in scan_count, ignored for first-in and last-out. */
  isDuplicate: boolean;
}

export interface DayContext {
  /** False for groups like External Staff, and for dates that are not school days. */
  expectsAttendance: boolean;
  isSchoolDay: boolean;
  /**
   * The instant after which arriving counts as late. Null when no threshold
   * applies to this person's group and none is configured globally.
   */
  lateThreshold: Date | null;
  /**
   * The instant from which an absence may be declared — never midnight
   * (specification §8: "Never mark the whole school absent at midnight").
   */
  absenceDecidedFrom: Date;
  /** The moment the computation is being made for. */
  now: Date;
}

export interface DayRecordComputation {
  status: DayStatus;
  isLate: boolean;
  firstIn: Date | null;
  lastOut: Date | null;
  /**
   * The last scan that counted, whichever way it went: when they last
   * moved. Null when nothing was seen. Duplicate taps do not move it.
   */
  lastMovementAt: Date | null;
  scanCount: number;
  /** Scans whose direction could not be determined. A data-quality signal. */
  unknownDirectionCount: number;
}

/**
 * Returns the person's day, or null when there is nothing worth recording
 * yet — a school day that has not reached the point where absence is
 * meaningful, with no scans. That null is what stops a nightly job from
 * marking the entire school absent the moment the date changes.
 */
export function computeDayRecord(
  scans: readonly DayScan[],
  ctx: DayContext,
): DayRecordComputation | null {
  const ordered = [...scans].sort(
    (a, b) => a.attTime.getTime() - b.attTime.getTime(),
  );
  const counted = ordered.filter((s) => !s.isDuplicate);
  const scanCount = ordered.length;
  const unknownDirectionCount = ordered.filter(
    (s) => s.direction === "unknown",
  ).length;

  const lastMovementAt = counted.at(-1)?.attTime ?? null;
  const empty = {
    firstIn: null,
    lastOut: null,
    lastMovementAt,
    scanCount,
    unknownDirectionCount,
    isLate: false,
  };

  // Nobody is expected: a contractor, or a day the school is not open. This
  // takes precedence over everything, including scans — someone being on
  // site on a Sunday is not an attendance fact.
  if (!ctx.expectsAttendance || !ctx.isSchoolDay) {
    return { ...empty, status: "not_expected", ...directionalTimes(counted) };
  }

  if (scanCount === 0) {
    // Expected, school day, nothing seen. Only an absence once the day has
    // actually got going; before that there is simply no news.
    if (ctx.now < ctx.absenceDecidedFrom) return null;
    return { ...empty, status: "absent" };
  }

  const { firstIn, lastOut } = directionalTimes(counted);

  // Scanned, but nothing we could give a direction to. Calling that absent
  // would be worse than wrong: it would report a child as missing when the
  // evidence says they were at the gate. Treated as present, and the
  // unknown-direction count surfaces the data-quality problem in admin.
  if (firstIn === null) {
    return { ...empty, status: "on_site", firstIn: null, lastOut: null };
  }

  const isLate = ctx.lateThreshold !== null && firstIn > ctx.lateThreshold;
  const status: DayStatus = lastOut === null ? "on_site" : "departed";

  return {
    status,
    isLate,
    firstIn,
    lastOut,
    lastMovementAt,
    scanCount,
    unknownDirectionCount,
  };
}

/**
 * `first_in` is the earliest arrival. `last_out` is the latest departure,
 * but only when no arrival follows it — someone who leaves at lunch and
 * comes back is on site, not departed.
 */
function directionalTimes(scans: readonly DayScan[]): {
  firstIn: Date | null;
  lastOut: Date | null;
} {
  let firstIn: Date | null = null;
  let lastOut: Date | null = null;

  for (const scan of scans) {
    if (scan.direction === "in") {
      if (firstIn === null) firstIn = scan.attTime;
      // A later arrival cancels a departure that came before it.
      if (lastOut !== null && scan.attTime > lastOut) lastOut = null;
    } else if (scan.direction === "out") {
      if (firstIn !== null) lastOut = scan.attTime;
    }
  }

  return { firstIn, lastOut };
}
