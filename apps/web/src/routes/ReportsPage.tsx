import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import {
  Button,
  EmptyState,
  ErrorState,
  TableSkeleton,
  inputClass,
} from "../components/primitives.js";
import {
  api,
  type Branch,
  type CurrentUser,
  type GroupCount,
  type SummaryResponse,
} from "../lib/api.js";
import { formatDate, SCHOOL_NAME, schoolToday } from "../lib/format.js";

/**
 * Attendance over a range.
 *
 * Sortable on every column, with the aggregate pinned above the rows so the
 * school-wide figure is read first and each person is read against it.
 */

interface PersonReportRow {
  personId: string;
  enrollNo: string;
  fullName: string;
  groupName: string | null;
  branch: Branch | null;
  tutorInitials: string | null;
  daysPresent: number;
  daysAbsent: number;
  daysExpected: number;
  lateCount: number;
  attendancePercentage: number | null;
  averageArrivalSeconds: number | null;
}

interface AttendanceReport {
  from: string;
  to: string;
  schoolDaysInRange: number;
  rows: PersonReportRow[];
  totals: {
    people: number;
    daysPresent: number;
    daysAbsent: number;
    daysExpected: number;
    lateCount: number;
    attendancePercentage: number | null;
    averageArrivalSeconds: number | null;
  };
}

type SortKey =
  | "fullName"
  | "enrollNo"
  | "groupName"
  | "daysPresent"
  | "daysAbsent"
  | "lateCount"
  | "attendancePercentage"
  | "averageArrivalSeconds";

export function ReportsPage() {
  const user = useOutletContext<CurrentUser>();
  const today = schoolToday();
  const [searchParams, setSearchParams] = useSearchParams();

  const from = searchParams.get("from") ?? startOfMonth(today);
  const to = searchParams.get("to") ?? today;
  const branch = (searchParams.get("branch") as Branch | null) ?? null;
  const group = searchParams.get("group");

  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>(
    {
      key: "fullName",
      direction: "asc",
    },
  );

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const query = useMemo(() => {
    const params = new URLSearchParams({ from, to });
    if (branch) params.set("branch", branch);
    if (group) params.set("group", group);
    return params.toString();
  }, [from, to, branch, group]);

  const report = useQuery({
    queryKey: ["report", query],
    queryFn: () =>
      api.get<AttendanceReport>(`/api/reports/attendance?${query}`),
  });

  const summary = useQuery({
    queryKey: ["summary-groups", today],
    queryFn: () =>
      api.get<SummaryResponse>(`/api/register/summary?date=${today}`),
  });

  const sorted = useMemo(() => {
    const rows = [...(report.data?.rows ?? [])];
    const { key, direction } = sort;
    rows.sort((a, b) => {
      const left = a[key];
      const right = b[key];
      // Nulls always sort last, whichever direction is chosen: "no data" is
      // not a small number and should not lead the table.
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      const comparison =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      return direction === "asc" ? comparison : -comparison;
    });
    return rows;
  }, [report.data, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : {
            key,
            direction:
              key === "fullName" || key === "groupName" ? "asc" : "desc",
          },
    );
  };

  const exportUrl = `/api/reports/attendance?${query}&format=csv`;
  const groups = (summary.data?.groups ?? []).filter(
    (g) => user.role === "full" || g.branch === "student",
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Printed instead of the controls: the sheet must explain itself. */}
      <div className="hidden print:block print:mb-4">
        <h1 className="text-lg font-semibold">{SCHOOL_NAME} — attendance report</h1>
        <p className="text-sm">
          {formatDate(from)} to {formatDate(to)}
          {report.data ? ` · ${report.data.schoolDaysInRange} school days` : ""}
        </p>
        <p className="text-sm">{describeFilters(branch, group, groups)}</p>
      </div>

      <div className="flex shrink-0 flex-wrap items-end gap-2 border-b border-neutral-200 bg-white px-3 py-2 print:hidden">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">From</span>
          <input
            type="date"
            className={inputClass}
            value={from}
            max={to}
            onChange={(e) => setParam("from", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">To</span>
          <input
            type="date"
            className={inputClass}
            value={to}
            max={today}
            onChange={(e) => setParam("to", e.target.value)}
          />
        </label>

        <div className="flex gap-1">
          <Button
            onClick={() => {
              setParam("from", today);
              setParam("to", today);
            }}
          >
            Today
          </Button>
          <Button
            onClick={() => {
              setParam("from", startOfWeek(today));
              setParam("to", today);
            }}
          >
            This week
          </Button>
          <Button
            onClick={() => {
              setParam("from", startOfMonth(today));
              setParam("to", today);
            }}
          >
            This month
          </Button>
        </div>

        {user.role === "full" && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600">Branch</span>
            <select
              className={inputClass}
              value={branch ?? ""}
              onChange={(e) => setParam("branch", e.target.value || null)}
            >
              <option value="">Everyone</option>
              <option value="student">Students</option>
              <option value="staff">Staff</option>
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">Group</span>
          <select
            className={inputClass}
            value={group ?? ""}
            onChange={(e) => setParam("group", e.target.value || null)}
          >
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.groupId} value={g.groupId}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex gap-2">
          <Button onClick={() => window.print()}>Print</Button>
          {/* A plain link, so the browser downloads it with the filename the
              server chose rather than a blob with a generated name. */}
          <a
            href={exportUrl}
            className="inline-flex items-center rounded bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
          >
            Export CSV
          </a>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto print:overflow-visible">
        {report.isPending && <TableSkeleton />}

        {report.isError && (
          <ErrorState
            title="The report could not be produced."
            detail="The date range may be too long, or the server did not answer."
            onRetry={() => void report.refetch()}
          />
        )}

        {report.isSuccess && report.data.rows.length === 0 && (
          <EmptyState
            title="Nobody matches this range and these filters."
            detail="Widen the dates, or clear the group filter."
          />
        )}

        {report.isSuccess && report.data.rows.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-neutral-50 print:static">
              <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-600">
                <SortableHeader
                  label="Name"
                  sortKey="fullName"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHeader
                  label="ID"
                  sortKey="enrollNo"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHeader
                  label="Group"
                  sortKey="groupName"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHeader
                  label="Present"
                  sortKey="daysPresent"
                  sort={sort}
                  onSort={toggleSort}
                  numeric
                />
                <SortableHeader
                  label="Absent"
                  sortKey="daysAbsent"
                  sort={sort}
                  onSort={toggleSort}
                  numeric
                />
                <SortableHeader
                  label="Late"
                  sortKey="lateCount"
                  sort={sort}
                  onSort={toggleSort}
                  numeric
                />
                <SortableHeader
                  label="Attendance"
                  sortKey="attendancePercentage"
                  sort={sort}
                  onSort={toggleSort}
                  numeric
                />
                <SortableHeader
                  label="Avg arrival"
                  sortKey="averageArrivalSeconds"
                  sort={sort}
                  onSort={toggleSort}
                  numeric
                />
              </tr>
            </thead>
            <tbody>
              {/* The aggregate, pinned above the rows. */}
              <tr className="border-b-2 border-neutral-300 bg-neutral-50 font-medium">
                <td className="px-3 py-2">
                  All {report.data.totals.people} people
                </td>
                <td />
                <td />
                <td className="tabular px-3 py-2 text-right">
                  {report.data.totals.daysPresent}
                </td>
                <td className="tabular px-3 py-2 text-right">
                  {report.data.totals.daysAbsent}
                </td>
                <td className="tabular px-3 py-2 text-right">
                  {report.data.totals.lateCount}
                </td>
                <td className="tabular px-3 py-2 text-right">
                  {formatPercent(report.data.totals.attendancePercentage)}
                </td>
                <td className="tabular px-3 py-2 text-right">
                  {formatArrival(report.data.totals.averageArrivalSeconds)}
                </td>
              </tr>

              {sorted.map((row) => (
                <tr key={row.personId} className="border-b border-neutral-100">
                  <td className="px-3 py-1.5 text-neutral-800">
                    {row.fullName}
                  </td>
                  <td className="tabular px-3 py-1.5 text-neutral-500">
                    {row.enrollNo}
                  </td>
                  <td className="px-3 py-1.5 text-neutral-600">
                    {row.groupName ?? "—"}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right">
                    {row.daysPresent}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right">
                    {row.daysAbsent}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right">
                    {row.lateCount}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right">
                    {formatPercent(row.attendancePercentage)}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right">
                    {formatArrival(row.averageArrivalSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  numeric,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; direction: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  numeric?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`px-3 py-2 ${numeric ? "text-right" : ""}`}
      aria-sort={
        active
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-neutral-800 ${active ? "text-brand-700" : ""}`}
      >
        {label}
        <span aria-hidden className="text-[0.6rem]">
          {active ? (sort.direction === "asc" ? "▲" : "▼") : " "}
        </span>
      </button>
    </th>
  );
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function formatArrival(seconds: number | null): string {
  if (seconds === null) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function describeFilters(
  branch: Branch | null,
  group: string | null,
  groups: GroupCount[],
): string {
  const parts: string[] = [];
  if (branch) parts.push(branch === "staff" ? "Staff" : "Students");
  if (group) {
    const found = groups.find((g) => String(g.groupId) === group);
    parts.push(`Group: ${found?.name ?? group}`);
  }
  return parts.length > 0
    ? `Filters — ${parts.join("; ")}`
    : "No filters applied";
}

function startOfWeek(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  // Monday, since a school week does.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
