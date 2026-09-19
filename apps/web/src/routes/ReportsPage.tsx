import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  DownloadIcon,
  PrinterIcon,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { PrintHeader } from "@/components/PrintHeader.js";
import {
  CardSkeleton,
  EmptyState,
  ErrorState,
  PageHeader,
  TableSkeleton,
} from "@/components/states.js";
import { Button } from "@/components/ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
import { Input, NativeSelect } from "@/components/ui/input.js";
import { Avatar, Field, Skeleton } from "@/components/ui/misc.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.js";
import {
  api,
  type Branch,
  type CurrentUser,
  type GroupCount,
  type SummaryResponse,
} from "@/lib/api.js";
import { formatDate, schoolName, schoolToday } from "@/lib/format.js";
import { usePrintSetup } from "@/lib/print.js";
import { cn } from "@/lib/utils.js";

const DailyChart = lazy(() => import("@/components/charts/DailyChart.js"));

/**
 * Attendance over a range.
 *
 * The trend first, then the figures, then the people: a head reads the
 * shape of the month before asking who pulled it down. Sortable on every
 * column, with the aggregate pinned above the rows so each person is read
 * against the school.
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

interface DailyReport {
  days: Array<{
    date: string;
    present: number;
    absent: number;
    late: number;
    expected: number;
  }>;
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

  const setParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const query = useMemo(() => {
    const params = new URLSearchParams({ from, to });
    if (branch) params.set("branch", branch);
    if (group) params.set("group", group);
    return params.toString();
  }, [from, to, branch, group]);

  // The browser's own print header, and the PDF's file name.
  usePrintSetup(
    `${schoolName()} — Attendance report — ${formatDate(from)} to ${formatDate(to)}`,
  );

  const report = useQuery({
    queryKey: ["report", query],
    queryFn: () =>
      api.get<AttendanceReport>(`/api/reports/attendance?${query}`),
  });

  const daily = useQuery({
    queryKey: ["report-daily", query],
    queryFn: () => api.get<DailyReport>(`/api/reports/daily?${query}`),
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
  const totals = report.data?.totals;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 lg:p-5 print:h-auto print:gap-3 print:overflow-visible print:p-0">
      {/* Printed instead of the controls: the sheet must explain itself. */}
      <PrintHeader
        title="Attendance report"
        lines={[
          `${formatDate(from)} to ${formatDate(to)}${
            report.data ? ` · ${report.data.schoolDaysInRange} school days` : ""
          }`,
          describeFilters(branch, group, groups),
        ]}
        preparedBy={user.fullName}
      />

      <PageHeader
        className="print:hidden"
        title="Reports"
        description={`${formatDate(from)} to ${formatDate(to)}${
          report.data ? ` · ${report.data.schoolDaysInRange} school days` : ""
        }`}
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <PrinterIcon /> Print
            </Button>
            {/* A plain link, so the browser downloads it with the filename the
                server chose rather than a blob with a generated name. */}
            <Button asChild>
              <a href={exportUrl}>
                <DownloadIcon /> Export CSV
              </a>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From">
            <Input
              type="date"
              className="tabular w-[10.5rem]"
              value={from}
              max={to}
              onChange={(e) =>
                e.target.value && setParams({ from: e.target.value })
              }
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              className="tabular w-[10.5rem]"
              value={to}
              max={today}
              onChange={(e) =>
                e.target.value && setParams({ to: e.target.value })
              }
            />
          </Field>

          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setParams({ from: today, to: today })}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setParams({ from: startOfWeek(today), to: today })}
            >
              This week
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setParams({ from: startOfMonth(today), to: today })
              }
            >
              This month
            </Button>
          </div>

          {user.role === "full" && (
            <Field label="Branch">
              <NativeSelect
                value={branch ?? ""}
                onChange={(e) => setParams({ branch: e.target.value || null })}
              >
                <option value="">Everyone</option>
                <option value="student">Students</option>
                <option value="staff">Staff</option>
              </NativeSelect>
            </Field>
          )}

          <Field label="Group">
            <NativeSelect
              value={group ?? ""}
              onChange={(e) => setParams({ group: e.target.value || null })}
            >
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g.groupId} value={g.groupId}>
                  {g.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-xs xl:grid-cols-4 print:grid-cols-4 print:rounded-md print:border-black/20 print:bg-black/20">
        {report.isPending ? (
          <>
            <CardSkeleton className="rounded-none border-0" />
            <CardSkeleton className="rounded-none border-0" />
            <CardSkeleton className="rounded-none border-0" />
            <CardSkeleton className="rounded-none border-0" />
          </>
        ) : (
          <>
            <Stat label="People" value={String(totals?.people ?? 0)} />
            <Stat
              label="Attendance"
              value={formatPercent(totals?.attendancePercentage ?? null)}
              accent="text-status-onsite"
              bar={totals?.attendancePercentage ?? 0}
              barClass="bg-status-onsite"
            />
            <Stat
              label="Late arrivals"
              value={String(totals?.lateCount ?? 0)}
              accent="text-status-late"
              hint={
                totals && totals.daysPresent > 0
                  ? `${((totals.lateCount / totals.daysPresent) * 100).toFixed(1)}% of present days`
                  : undefined
              }
            />
            <Stat
              label="Average arrival"
              value={formatArrival(totals?.averageArrivalSeconds ?? null)}
              hint={
                totals ? `${totals.daysAbsent} absent days in range` : undefined
              }
            />
          </>
        )}
      </div>

      <Card className="print:rounded-md print:border-black/20 print:break-inside-avoid">
        <CardHeader>
          <CardTitle>Attendance by day</CardTitle>
        </CardHeader>
        <CardContent>
          {daily.isPending && <Skeleton className="h-40 w-full" />}
          {daily.isSuccess && daily.data.days.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing recorded in this range yet.
            </p>
          )}
          {daily.isSuccess && daily.data.days.length > 0 && (
            <Suspense fallback={<Skeleton className="h-48 w-full" />}>
              <DailyChart days={daily.data.days} />
            </Suspense>
          )}
        </CardContent>
      </Card>

      {/* On paper the table runs across pages on its own hairlines; a box
          around it would be cut open at every break. */}
      <Card className="min-h-0 shrink-0 overflow-hidden print:block print:rounded-none print:border-0 print:overflow-visible">
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
          <div className="overflow-x-auto print:overflow-visible">
            <Table>
              <TableHeader className="sticky top-0 bg-card print:static">
                <TableRow className="hover:bg-transparent">
                  <SortableHead
                    label="Name"
                    sortKey="fullName"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHead
                    label="ID"
                    sortKey="enrollNo"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHead
                    label="Group"
                    sortKey="groupName"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHead
                    label="Present"
                    sortKey="daysPresent"
                    sort={sort}
                    onSort={toggleSort}
                    numeric
                  />
                  <SortableHead
                    label="Absent"
                    sortKey="daysAbsent"
                    sort={sort}
                    onSort={toggleSort}
                    numeric
                  />
                  <SortableHead
                    label="Late"
                    sortKey="lateCount"
                    sort={sort}
                    onSort={toggleSort}
                    numeric
                  />
                  <SortableHead
                    label="Attendance"
                    sortKey="attendancePercentage"
                    sort={sort}
                    onSort={toggleSort}
                    numeric
                  />
                  <SortableHead
                    label="Avg arrival"
                    sortKey="averageArrivalSeconds"
                    sort={sort}
                    onSort={toggleSort}
                    numeric
                  />
                  <TableHead className="w-8 print:hidden" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* The aggregate, pinned above the rows. */}
                <TableRow className="bg-muted/40 font-medium hover:bg-muted/40">
                  <TableCell>All {report.data.totals.people} people</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="tabular text-right">
                    {report.data.totals.daysPresent}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {report.data.totals.daysAbsent}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {report.data.totals.lateCount}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatPercent(report.data.totals.attendancePercentage)}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatArrival(report.data.totals.averageArrivalSeconds)}
                  </TableCell>
                  <TableCell className="print:hidden" />
                </TableRow>

                {sorted.map((row) => (
                  <TableRow key={row.personId}>
                    <TableCell>
                      <Link
                        to={`/reports/person/${row.personId}?from=${from}&to=${to}`}
                        className="flex items-center gap-2.5 hover:text-primary print:no-underline"
                      >
                        <Avatar
                          name={row.fullName}
                          size="sm"
                          className="print:hidden"
                        />
                        <span className="font-medium">{row.fullName}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      {row.enrollNo}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.groupName ?? "—"}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {row.daysPresent}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {row.daysAbsent}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular text-right",
                        row.lateCount > 0 && "text-status-late",
                      )}
                    >
                      {row.lateCount}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      <AttendanceCell value={row.attendancePercentage} />
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatArrival(row.averageArrivalSeconds)}
                    </TableCell>
                    <TableCell className="print:hidden">
                      <ChevronRightIcon className="size-4 text-muted-foreground/50" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  hint,
  bar,
  barClass,
}: {
  label: string;
  value: string;
  accent?: string;
  hint?: string | undefined;
  bar?: number;
  barClass?: string;
}) {
  return (
    <div className="flex flex-col gap-1 bg-card p-4">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={cn("tabular text-2xl font-semibold tracking-tight", accent)}
      >
        {value}
      </span>
      {bar !== undefined && (
        <span className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
          <span
            className={cn("block h-full rounded-full", barClass)}
            style={{ width: `${bar}%` }}
          />
        </span>
      )}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function AttendanceCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
        <span
          className={cn(
            "block h-full rounded-full",
            value >= 95
              ? "bg-status-onsite"
              : value >= 85
                ? "bg-status-late"
                : "bg-status-absent",
          )}
          style={{ width: `${value}%` }}
        />
      </span>
      <span className={cn(value < 85 && "text-status-absent font-medium")}>
        {value.toFixed(1)}%
      </span>
    </span>
  );
}

function SortableHead({
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
    <TableHead
      className={cn(numeric && "text-right")}
      aria-sort={
        active
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 rounded hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        {active ? (
          sort.direction === "asc" ? (
            <ArrowUpIcon className="size-3" />
          ) : (
            <ArrowDownIcon className="size-3" />
          )
        ) : (
          <span className="size-3" />
        )}
      </button>
    </TableHead>
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
