import type { DayStatus } from "./api.js";

/**
 * How times and statuses are rendered.
 *
 * Times are shown in the school's timezone, not the browser's: someone
 * looking at this from elsewhere must see the same clock the school does.
 */
export const SCHOOL_TIMEZONE = "Asia/Colombo";

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SCHOOL_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SCHOOL_TIMEZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

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

/** Today in the school's timezone, as YYYY-MM-DD. */
export function schoolToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
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
