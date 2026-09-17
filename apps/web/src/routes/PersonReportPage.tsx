import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Button,
  EmptyState,
  ErrorState,
  StatusBadge,
  TableSkeleton,
  inputClass,
} from "../components/primitives.js";
import { api, ApiError, type Branch, type PersonDay } from "../lib/api.js";
import {
  formatDate,
  formatTime,
  NO_TIME,
  schoolName,
  schoolToday,
} from "../lib/format.js";

/**
 * One person over a range: the figures the school-wide report gives them,
 * and the day-by-day record those figures were computed from. This is the
 * page a head of year prints before a conversation with a parent, so it
 * has to explain itself on paper.
 */

interface PersonReport {
  person: {
    id: string;
    enrollNo: string;
    fullName: string;
    groupName: string | null;
    branch: Branch | null;
    tutorInitials: string | null;
  };
  from: string;
  to: string;
  schoolDaysInRange: number;
  days: PersonDay[];
  summary: {
    daysPresent: number;
    daysAbsent: number;
    daysExpected: number;
    lateCount: number;
    attendancePercentage: number | null;
    averageArrivalSeconds: number | null;
  } | null;
}

export function PersonReportPage() {
  const { id = "" } = useParams();
  const today = schoolToday();
  const [searchParams, setSearchParams] = useSearchParams();

  const from = searchParams.get("from") ?? startOfMonth(today);
  const to = searchParams.get("to") ?? today;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const report = useQuery({
    queryKey: ["person-report", id, from, to],
    queryFn: () =>
      api.get<PersonReport>(`/api/reports/person/${id}?from=${from}&to=${to}`),
    retry: false,
  });

  const exportUrl = `/api/reports/person/${id}?from=${from}&to=${to}&format=csv`;
  const backTo = `/reports?${new URLSearchParams({ from, to }).toString()}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hidden print:block print:mb-4">
        <h1 className="text-lg font-semibold">
          {schoolName()} — attendance report
        </h1>
        {report.data && (
          <p className="text-sm">
            {report.data.person.fullName} · {report.data.person.enrollNo}
            {report.data.person.groupName &&
              ` · ${report.data.person.groupName}`}
          </p>
        )}
        <p className="text-sm">
          {formatDate(from)} to {formatDate(to)}
          {report.data ? ` · ${report.data.schoolDaysInRange} school days` : ""}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-end gap-2 border-b border-neutral-200 bg-white px-3 py-2 print:hidden">
        <Link
          to={backTo}
          className="self-center text-sm text-brand-700 hover:underline"
        >
          ← All people
        </Link>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">From</span>
          <input
            type="date"
            className={inputClass}
            value={from}
            max={to}
            onChange={(e) => e.target.value && setParam("from", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">To</span>
          <input
            type="date"
            className={inputClass}
            value={to}
            max={today}
            onChange={(e) => e.target.value && setParam("to", e.target.value)}
          />
        </label>

        <div className="ml-auto flex gap-2">
          <Button onClick={() => window.print()}>Print</Button>
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
            title={
              report.error instanceof ApiError && report.error.status === 404
                ? "There is nobody here by that reference."
                : "The report could not be produced."
            }
            detail={
              report.error instanceof ApiError && report.error.status === 404
                ? "They may have been removed, or the link may be wrong."
                : "The date range may be too long, or the server did not answer."
            }
            onRetry={() => void report.refetch()}
          />
        )}

        {report.isSuccess && (
          <div className="mx-auto max-w-4xl p-4">
            <header className="mb-4 print:hidden">
              <h1 className="text-lg font-semibold text-neutral-900">
                {report.data.person.fullName}
              </h1>
              <p className="tabular text-sm text-neutral-500">
                {report.data.person.enrollNo}
                {report.data.person.groupName &&
                  ` · ${report.data.person.groupName}`}
                {report.data.person.tutorInitials &&
                  ` · Tutor ${report.data.person.tutorInitials}`}
              </p>
            </header>

            <Summary report={report.data} />

            <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Day by day
            </h2>

            {report.data.days.length === 0 ? (
              <EmptyState
                title="Nothing recorded in this range."
                detail="Days appear here once a scan arrives or an absence is decided."
              />
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead className="bg-neutral-50">
                  <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-600">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">First in</th>
                    <th className="px-3 py-2 text-right">Last out</th>
                    <th className="px-3 py-2 text-right">Scans</th>
                    <th className="px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.days.map((day) => (
                    <tr key={day.id} className="border-b border-neutral-100">
                      <td className="px-3 py-1.5 text-neutral-800">
                        {formatDate(day.date)}
                      </td>
                      <td className="px-3 py-1.5">
                        <StatusBadge status={day.status} isLate={day.isLate} />
                      </td>
                      <td
                        className={`tabular px-3 py-1.5 text-right ${day.firstIn ? "" : "text-neutral-400"}`}
                      >
                        {formatTime(day.firstIn)}
                      </td>
                      <td
                        className={`tabular px-3 py-1.5 text-right ${day.lastOut ? "" : "text-neutral-400"}`}
                      >
                        {day.lastOut ? formatTime(day.lastOut) : NO_TIME}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right text-neutral-600">
                        {day.scanCount}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-neutral-500">
                        {day.hasManualEdit ? "Corrected by hand" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ report }: { report: PersonReport }) {
  const s = report.summary;
  const tiles: Array<{ label: string; value: string }> = [
    { label: "School days", value: String(report.schoolDaysInRange) },
    { label: "Present", value: s ? String(s.daysPresent) : NO_TIME },
    { label: "Absent", value: s ? String(s.daysAbsent) : NO_TIME },
    { label: "Late", value: s ? String(s.lateCount) : NO_TIME },
    {
      label: "Attendance",
      value:
        s?.attendancePercentage === null || s === null
          ? NO_TIME
          : `${s.attendancePercentage.toFixed(1)}%`,
    },
    {
      label: "Average arrival",
      value: s ? formatArrival(s.averageArrivalSeconds) : NO_TIME,
    },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          role="group"
          aria-label={tile.label}
          className="min-w-[6.5rem] rounded border border-neutral-200 bg-white px-3 py-2"
        >
          <span className="tabular block text-xl font-semibold text-neutral-800">
            {tile.value}
          </span>
          <span className="block text-xs text-neutral-500">{tile.label}</span>
        </div>
      ))}
    </div>
  );
}

function formatArrival(seconds: number | null): string {
  if (seconds === null) return NO_TIME;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
