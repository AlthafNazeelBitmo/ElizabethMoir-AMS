import type { Branch, DayStatus, RegisterStatus } from "./api.js";

/**
 * Filters live in the URL so a view can be bookmarked and shared — the
 * office and the head can send each other a link to exactly what they are
 * looking at, and a reload does not lose the view.
 */
/**
 * What the list is narrowed to. "checked_in" — everyone who has scanned in
 * today, whatever their status since — is the register's resting state:
 * the screen is about who is here, and a school of six hundred names with
 * a dash beside most of them is not that. "any" is the whole roll. A
 * single status is a single status; "late" is the late flag, which sits
 * on top of on site or departed.
 */
export type StatusFilter = RegisterStatus | "checked_in" | "any";

export const DEFAULT_STATUS: StatusFilter = "checked_in";

/** A group's id, or "none" for the people who are in no group. */
export type GroupFilter = number | "none";

export interface RegisterFilters {
  date: string;
  branch: Branch | null;
  group: GroupFilter | null;
  tutor: number | null;
  status: StatusFilter;
  q: string;
}

export function filtersFromSearch(params: URLSearchParams, today: string): RegisterFilters {
  const num = (key: string): number | null => {
    const raw = params.get(key);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isInteger(parsed) ? parsed : null;
  };
  const branch = params.get("branch");
  const status = params.get("status");
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : today,
    branch: branch === "student" || branch === "staff" ? branch : null,
    group: params.get("group") === "none" ? "none" : num("group"),
    tutor: num("tutor"),
    status: status === "any" || isStatus(status) ? status : DEFAULT_STATUS,
    q: params.get("q") ?? "",
  };
}

export function searchFromFilters(filters: RegisterFilters, today: string): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.date !== today) params.set("date", filters.date);
  if (filters.branch) params.set("branch", filters.branch);
  if (filters.group !== null) params.set("group", String(filters.group));
  if (filters.tutor !== null) params.set("tutor", String(filters.tutor));
  if (filters.status !== DEFAULT_STATUS) params.set("status", filters.status);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  return params;
}

/** What the API is asked for. The date always travels, unlike in the URL. */
export function queryFromFilters(filters: RegisterFilters): URLSearchParams {
  const params = new URLSearchParams({ date: filters.date });
  if (filters.branch) params.set("branch", filters.branch);
  if (filters.group !== null) params.set("group", String(filters.group));
  if (filters.tutor !== null) params.set("tutor", String(filters.tutor));
  // Status and free text are applied in the browser: the rows are already
  // here, and filtering them locally keeps typing instant and avoids a
  // refetch that would fight the live stream.
  return params;
}

/** Whether anything is set beyond the date, which decides if "Clear" shows. */
export function hasActiveFilters(filters: RegisterFilters): boolean {
  return (
    filters.branch !== null ||
    filters.group !== null ||
    filters.tutor !== null ||
    filters.status !== DEFAULT_STATUS ||
    filters.q.trim() !== ""
  );
}

/**
 * Whether a row passes the status filter, in the same terms as the counts
 * on the tiles and the rail: on site and departed are presence — scanned
 * in and not out, scanned out — whatever the day's verdict, so a Sunday's
 * scans or a contractor's still count as here; absent and not expected
 * are the verdict; late is the flag.
 */
export function matchesStatus(
  row: {
    status: RegisterStatus;
    isLate: boolean;
    firstIn: string | null;
    lastOut: string | null;
  },
  status: StatusFilter,
): boolean {
  switch (status) {
    case "any":
      return true;
    case "checked_in":
      return row.firstIn !== null;
    case "on_site":
      return row.firstIn !== null && row.lastOut === null;
    case "departed":
      return row.lastOut !== null;
    case "late":
      return row.isLate;
    default:
      return row.status === status;
  }
}

function isStatus(value: string | null): value is RegisterStatus {
  return (
    value === "on_site" ||
    value === "departed" ||
    value === "late" ||
    value === "absent" ||
    value === "not_expected" ||
    value === "pending"
  );
}
