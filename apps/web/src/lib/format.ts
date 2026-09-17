import type { DayStatus } from "./api.js";

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
  className: string;
  dotClassName: string;
}

export const STATUS_PRESENTATION: Record<DayStatus, StatusPresentation> = {
  on_site: {
    label: "On site",
    shape: "filled",
    className: "text-brand-700 bg-brand-50 border-brand-200",
    dotClassName: "bg-brand-700",
  },
  departed: {
    label: "Departed",
    shape: "half",
    className: "text-neutral-600 bg-neutral-100 border-neutral-300",
    dotClassName: "bg-neutral-500",
  },
  late: {
    label: "Late",
    shape: "hollow",
    className: "text-status-late bg-status-lateBg border-amber-300",
    dotClassName: "bg-status-late",
  },
  absent: {
    label: "Absent",
    shape: "cross",
    className: "text-status-absent bg-status-absentBg border-rose-200",
    dotClassName: "bg-status-absent",
  },
  not_expected: {
    label: "Not expected",
    shape: "outline",
    className: "text-neutral-500 bg-transparent border-neutral-300 border-dashed",
    dotClassName: "border border-neutral-400 bg-transparent",
  },
};

export const STATUS_ORDER: DayStatus[] = [
  "on_site",
  "departed",
  "late",
  "absent",
  "not_expected",
];
