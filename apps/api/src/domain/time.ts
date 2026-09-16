import { ATT_TIME_PATTERN } from "@ams/shared";

/**
 * Converting between the feed's naive local timestamps and real instants.
 *
 * The reader transmits `YYYY-MM-DD HH:mm:ss` with no offset. Which zone that
 * is in is a configured setting, not a constant, because it is one of the
 * facts the discovery run exists to establish — and because a school could
 * in principle move. Every conversion goes through the IANA database via
 * `Intl`, never through an assumed fixed offset.
 *
 * `scans.att_time_local` keeps the transmitted string verbatim, so if the
 * configured zone later turns out to be wrong, every scan can be converted
 * again from the original without asking the vendor for anything.
 */

export interface NaiveLocal {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function parseNaiveLocal(s: string): NaiveLocal | null {
  const m = ATT_TIME_PATTERN.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const naive: NaiveLocal = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(se),
  };
  // Reject impossible dates the regex would otherwise wave through (31 Feb).
  const probe = new Date(
    Date.UTC(
      naive.year,
      naive.month - 1,
      naive.day,
      naive.hour,
      naive.minute,
      naive.second,
    ),
  );
  if (
    probe.getUTCFullYear() !== naive.year ||
    probe.getUTCMonth() !== naive.month - 1 ||
    probe.getUTCDate() !== naive.day
  ) {
    return null;
  }
  return naive;
}

export function formatNaiveLocal(n: NaiveLocal): string {
  const p = (v: number, w = 2) => String(v).padStart(w, "0");
  return `${p(n.year, 4)}-${p(n.month)}-${p(n.day)} ${p(n.hour)}:${p(n.minute)}:${p(n.second)}`;
}

/** True when the string names a zone the runtime's tz database knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** The wall-clock reading in `timeZone` at a given instant. */
export function utcToLocal(instant: Date, timeZone: string): NaiveLocal {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const v = parts.find((p) => p.type === type)?.value ?? "0";
    return Number(v);
  };
  // Some locales render midnight as hour 24; normalise it to 0.
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** The zone's offset from UTC, in minutes, at a given instant. */
export function offsetMinutesAt(instant: Date, timeZone: string): number {
  const local = utcToLocal(instant, timeZone);
  const asIfUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return (asIfUtc - instant.getTime()) / 60_000;
}

/**
 * Turns a wall-clock reading in `timeZone` into the instant it denotes.
 *
 * Two passes: guess the instant assuming the local reading is UTC, look up
 * the real offset there, correct, then confirm the offset did not change
 * across the correction (which it does near a DST transition).
 *
 * Sri Lanka has no daylight saving, so in practice the first pass is always
 * right — but the school is not the only possible deployment and a fixed
 * offset is exactly the kind of assumption that rots silently, so the
 * transitions are handled and tested.
 *
 * At a spring-forward gap the reading names a time that never existed; the
 * instant just after the gap is returned. At an autumn overlap the reading
 * is ambiguous; the earlier of the two instants is returned.
 */
export function localToUtc(local: NaiveLocal, timeZone: string): Date {
  const asIfUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );

  // Sample the offset a day either side rather than at the reading itself.
  // Probing only at the reading misses the autumn overlap: both probes land
  // after the transition, and the earlier of the two valid instants is never
  // considered.
  const DAY = 86_400_000;
  const offsets = new Set([
    offsetMinutesAt(new Date(asIfUtc - DAY), timeZone),
    offsetMinutesAt(new Date(asIfUtc + DAY), timeZone),
  ]);

  // Whichever candidate actually reads back as the requested wall time is the
  // correct one. Prefer the earlier when both do (the autumn overlap).
  const candidates = [...offsets]
    .map((o) => asIfUtc - o * 60_000)
    .sort((a, b) => a - b);
  for (const candidate of candidates) {
    const readBack = utcToLocal(new Date(candidate), timeZone);
    if (
      readBack.year === local.year &&
      readBack.month === local.month &&
      readBack.day === local.day &&
      readBack.hour === local.hour &&
      readBack.minute === local.minute &&
      readBack.second === local.second
    ) {
      return new Date(candidate);
    }
  }

  // Neither reads back: the wall time falls in a spring-forward gap, naming
  // a moment that never happened. Return the later candidate, which is the
  // instant the clock jumps to.
  return new Date(candidates[candidates.length - 1] ?? asIfUtc);
}

/**
 * Which school day a scan belongs to.
 *
 * Everything before `rolloverTime` on the local clock counts as the previous
 * school day, so a match finishing at half past midnight is recorded against
 * the day it started rather than opening an empty new one.
 */
export function schoolDayFor(
  instant: Date,
  timeZone: string,
  rolloverTime: string,
): string {
  const local = utcToLocal(instant, timeZone);
  const rollover = parseTimeOfDay(rolloverTime) ?? {
    hour: 0,
    minute: 0,
    second: 0,
  };
  const secondsIntoDay = local.hour * 3600 + local.minute * 60 + local.second;
  const rolloverSeconds =
    rollover.hour * 3600 + rollover.minute * 60 + rollover.second;

  const date = new Date(Date.UTC(local.year, local.month - 1, local.day));
  if (secondsIntoDay < rolloverSeconds) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.toISOString().slice(0, 10);
}

export interface TimeOfDay {
  hour: number;
  minute: number;
  second: number;
}

/** Parses `HH:mm` or `HH:mm:ss`. Returns null on anything else. */
export function parseTimeOfDay(s: string): TimeOfDay | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = Number(m[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

/** The instant a given time-of-day falls at, on a given local date. */
export function instantAtLocalTime(
  date: string,
  time: TimeOfDay,
  timeZone: string,
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return localToUtc(
    {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: time.hour,
      minute: time.minute,
      second: time.second,
    },
    timeZone,
  );
}
