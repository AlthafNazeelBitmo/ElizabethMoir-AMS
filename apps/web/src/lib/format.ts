import type { DayStatus, RegisterStatus } from "./api.js";

/**
 * How times and statuses are rendered.
 *
 * Times are shown in the school's timezone, not the browser's: someone
 * looking at this from elsewhere must see the same clock the school does.
 * The timezone and the school's name are settings, loaded once from
 * `/api/school` before any screen renders (see `App`), so a change made in
 * Admin → Rules is what every page uses and no constant here can drift
 * from it.
 */

export interface SchoolProfile {
  name: string;
  timezone: string;
  /** A short hash of the uploaded crest; null when there is none. */
  logoVersion?: string | null;
}

/** What is used until the server has answered. Matches the API's defaults. */
const FALLBACK: SchoolProfile = { name: "School", timezone: "Asia/Colombo" };

let profile: SchoolProfile = FALLBACK;
let timeFormatter = makeTimeFormatter(profile.timezone);
let dateFormatter = makeDateFormatter(profile.timezone);
let dateTimeFormatter = makeDateTimeFormatter(profile.timezone);
let isoDateFormatter = makeIsoDateFormatter(profile.timezone);

/** Called once, when the school profile arrives; rebuilds every formatter. */
export function configureSchool(next: SchoolProfile): void {
  if (!isValidTimeZone(next.timezone)) {
    // A timezone the browser does not know is the server's problem to
    // report; here it must not take the whole interface down.
    next = { ...next, timezone: FALLBACK.timezone };
  }
  profile = next;
  timeFormatter = makeTimeFormatter(next.timezone);
  dateFormatter = makeDateFormatter(next.timezone);
  dateTimeFormatter = makeDateTimeFormatter(next.timezone);
  isoDateFormatter = makeIsoDateFormatter(next.timezone);
}

export function schoolName(): string {
  return profile.name;
}

export function schoolTimezone(): string {
  return profile.timezone;
}

/**
 * The crest's version: a hash when one is uploaded, null when the school
 * has none, undefined before the profile is known (the sign-in page).
 */
export function schoolLogoVersion(): string | null | undefined {
  return profile.logoVersion;
}

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function makeTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function makeDateFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function makeDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  });
}

function makeIsoDateFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** An em dash, not "—:—" or "N/A": an absence of time reads as nothing. */
export const NO_TIME = "—";

/**
 * A time of day in the school's zone, as a time input shows it ("07:45"),
 * or "" for none. The inverse of `wallTimeToIso`.
 */
export function isoToWallTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: profile.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/**
 * The instant at which the school's clocks read `hhmm` on `date`, as ISO.
 * Found by taking the wall time as if it were UTC and correcting by the
 * zone's offset at that moment — twice, so a zone that changes offset that
 * day still lands on the right side of the change.
 */
export function wallTimeToIso(date: string, hhmm: string): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const [y, mo, d] = date.split("-").map(Number);
  if (!y || !mo || !d) return null;
  const asUtc = Date.UTC(y, mo - 1, d, Number(m[1]), Number(m[2]));
  let instant = asUtc - offsetMinutesAt(asUtc) * 60_000;
  instant = asUtc - offsetMinutesAt(instant) * 60_000;
  return new Date(instant).toISOString();
}

/** The zone's offset from UTC, in minutes, at a given instant. */
function offsetMinutesAt(epochMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: profile.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((wall - epochMs) / 60_000);
}

export function formatTime(iso: string | null): string {
  if (!iso) return NO_TIME;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? NO_TIME : timeFormatter.format(date);
}

export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(`${value}T12:00:00Z`) : value;
  return Number.isNaN(date.getTime()) ? "" : dateFormatter.format(date);
}

/** Date and time together, for audit entries and "last seen" columns. */
export function formatDateTime(value: string | Date | null): string {
  if (!value) return NO_TIME;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? NO_TIME : dateTimeFormatter.format(date);
}

/** Today in the school's timezone, as YYYY-MM-DD. */
export function schoolToday(): string {
  return isoDateFormatter.format(new Date());
}

export interface StatusPresentation {
  label: string;
  /** Colour is never the only carrier; each status also has a distinct shape. */
  shape: "filled" | "hollow" | "half" | "cross" | "outline";
  /** Text colour class. */
  text: string;
  /** Tinted background class. */
  bg: string;
  /** Solid colour class, for dots and bars. */
  solid: string;
}

export const STATUS_PRESENTATION: Record<RegisterStatus, StatusPresentation> = {
  on_site: {
    label: "Present",
    shape: "filled",
    text: "text-status-onsite",
    bg: "bg-status-onsite-bg",
    solid: "bg-status-onsite",
  },
  departed: {
    label: "Departed",
    shape: "half",
    text: "text-status-departed",
    bg: "bg-status-departed-bg",
    solid: "bg-status-departed",
  },
  late: {
    label: "Late",
    shape: "hollow",
    text: "text-status-late",
    bg: "bg-status-late-bg",
    solid: "bg-status-late",
  },
  absent: {
    label: "Absent",
    shape: "cross",
    text: "text-status-absent",
    bg: "bg-status-absent-bg",
    solid: "bg-status-absent",
  },
  not_expected: {
    label: "Not expected",
    shape: "outline",
    text: "text-muted-foreground",
    bg: "bg-transparent",
    solid: "bg-status-idle",
  },
  pending: {
    label: "Not arrived",
    shape: "outline",
    text: "text-muted-foreground",
    bg: "bg-transparent",
    solid: "bg-status-idle",
  },
};

export const STATUS_ORDER: DayStatus[] = [
  "on_site",
  "departed",
  "late",
  "absent",
  "not_expected",
];
