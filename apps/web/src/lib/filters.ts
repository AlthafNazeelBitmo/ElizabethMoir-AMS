import type { Branch, DayStatus } from "./api.js";

/**
 * Filters live in the URL so a view can be bookmarked and shared — the
 * office and the head can send each other a link to exactly what they are
 * looking at, and a reload does not lose the view.
 */
export interface RegisterFilters {
  date: string;
  branch: Branch | null;
  group: number | null;
  tutor: number | null;
  status: DayStatus | null;
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
    group: num("group"),
    tutor: num("tutor"),
    status: isStatus(status) ? status : null,
    q: params.get("q") ?? "",
  };
}

export function searchFromFilters(filters: RegisterFilters, today: string): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.date !== today) params.set("date", filters.date);
  if (filters.branch) params.set("branch", filters.branch);
  if (filters.group !== null) params.set("group", String(filters.group));
  if (filters.tutor !== null) params.set("tutor", String(filters.tutor));
  if (filters.status) params.set("status", filters.status);
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
    filters.status !== null ||
    filters.q.trim() !== ""
  );
}

function isStatus(value: string | null): value is DayStatus {
  return (
    value === "on_site" ||
    value === "departed" ||
    value === "late" ||
    value === "absent" ||
    value === "not_expected"
  );
}
