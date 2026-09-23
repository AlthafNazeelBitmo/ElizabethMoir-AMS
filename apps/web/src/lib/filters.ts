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

/**
 * The order of the list. "surname": A–Z by surname, which is how the
 * school reads a register and so the resting order. "latest": whoever
 * moved through a reader most recently is at the top — the register as a
 * feed of the door — with those who have not moved behind them, by
 * surname. "school": the school's own order, as the reports have it —
 * students before staff, groups as the school ordered them, each
 * person's place within their group.
 */
export type SortOrder = "surname" | "latest" | "school";

export const DEFAULT_SORT: SortOrder = "surname";

export interface RegisterFilters {
  date: string;
  branch: Branch | null;
  group: GroupFilter | null;
  tutor: number | null;
  status: StatusFilter;
  sort: SortOrder;
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
  const sort = params.get("sort");
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : today,
    branch: branch === "student" || branch === "staff" ? branch : null,
    group: params.get("group") === "none" ? "none" : num("group"),
    tutor: num("tutor"),
    status: status === "any" || isStatus(status) ? status : DEFAULT_STATUS,
    sort:
      sort === "school" || sort === "latest" || sort === "surname"
        ? sort
        : DEFAULT_SORT,
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
  if (filters.sort !== DEFAULT_SORT) params.set("sort", filters.sort);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  return params;
}

/** What the API is asked for. The date always travels, unlike in the URL. */
export function queryFromFilters(filters: RegisterFilters): URLSearchParams {
  const params = new URLSearchParams({ date: filters.date });
  if (filters.branch) params.set("branch", filters.branch);
  if (filters.group !== null) params.set("group", String(filters.group));
  if (filters.tutor !== null) params.set("tutor", String(filters.tutor));
  // Status, free text and the order are applied in the browser: the rows
  // are already here, and sorting and filtering them locally keeps typing
  // instant and avoids a refetch that would fight the live stream.
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

const TITLE = /^(mrs|mr|ms|dr|miss)\s*\.?\s*/i;

/**
 * A person's name as the school alphabetises it: the surname, then the
 * given name.
 *
 * The surname is everything after the first given name — "Lehana De
 * Silva" files under De Silva, "Julie Cobain Mendis" under Cobain
 * Mendis, "Imath Weerasinghe Don" under Weerasinghe Don — which is how
 * the school's own lists read, and matched them more closely than taking
 * the last word alone when both were checked against them. Someone with
 * two given names ("Tsz Hei Chau") files under the second, which is the
 * price of not asking the office to mark every surname by hand. Titles
 * and a nickname in brackets are set aside; one name alone is itself.
 */
export function surnameKey(fullName: string): { surname: string; given: string } {
  const cleaned = fullName
    .replace(/\(.*?\)/g, " ")
    .replace(TITLE, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(" ");
  if (parts.length < 2) return { surname: cleaned, given: "" };
  // Joined without their spaces, so "De Silva" sits between "Deraniyagala"
  // and "Dharmawansa" as it does on the school's list.
  return { surname: parts.slice(1).join(""), given: parts[0]! };
}

/** Compares two names the way the school alphabetises them. */
export function compareBySurname(
  left: { fullName: string },
  right: { fullName: string },
): number {
  const a = surnameKey(left.fullName);
  const b = surnameKey(right.fullName);
  return (
    a.surname.localeCompare(b.surname, "en", { sensitivity: "base" }) ||
    a.given.localeCompare(b.given, "en", { sensitivity: "base" })
  );
}

/**
 * The rows in the chosen order. They arrive from the server in the
 * school's order, which "school" keeps; "surname" alphabetises them; and
 * "latest" lifts whoever moved most recently to the top, leaving those
 * who have not moved today behind them, by surname.
 */
export function orderRows<
  T extends { lastMovementAt: string | null; fullName: string },
>(rows: readonly T[], sort: SortOrder): T[] {
  if (sort === "school") return [...rows];

  const alphabetical = [...rows].sort(compareBySurname);
  if (sort === "surname") return alphabetical;

  return alphabetical
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = a.row.lastMovementAt;
      const right = b.row.lastMovementAt;
      if (left === right) return a.index - b.index;
      if (left === null) return 1;
      if (right === null) return -1;
      // ISO instants in one zone compare as strings.
      return left < right ? 1 : -1;
    })
    .map(({ row }) => row);
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
