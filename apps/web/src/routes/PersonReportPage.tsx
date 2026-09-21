import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  DownloadIcon,
  PencilLineIcon,
  PrinterIcon,
} from "lucide-react";
import { lazy, Suspense } from "react";
import {
  Link,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { PrintHeader } from "@/components/PrintHeader.js";
import { StatusBadge } from "@/components/status.js";
import {
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
import { Input } from "@/components/ui/input.js";
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
  ApiError,
  type Branch,
  type CurrentUser,
  type PersonDay,
} from "@/lib/api.js";
import {
  formatDate,
  formatTime,
  NO_TIME,
  schoolName,
  schoolToday,
} from "@/lib/format.js";
import { usePrintSetup } from "@/lib/print.js";
import { cn } from "@/lib/utils.js";

const ArrivalChart = lazy(() => import("@/components/charts/ArrivalChart.js"));

/**
 * One person over a range: the figures the school-wide report gives them,
 * a picture of when they arrive, and the day-by-day record those figures
 * were computed from. This is the page a head of year prints before a
 * conversation with a parent, so it has to explain itself on paper.
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
  const user = useOutletContext<CurrentUser>();
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
  const person = report.data?.person;

  // The browser's own print header, and the PDF's file name.
  usePrintSetup(
    `${schoolName()} — Attendance${person ? ` — ${person.fullName}` : ""} — ${formatDate(from)} to ${formatDate(to)}`,
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 lg:p-5 print:h-auto print:gap-3 print:overflow-visible print:p-0">
      <PrintHeader
        title={person ? `Attendance report — ${person.fullName}` : "Attendance report"}
        lines={[
          person
            ? `${person.enrollNo}${person.groupName ? ` · ${person.groupName}` : ""}${
                person.tutorInitials ? ` · Tutor ${person.tutorInitials}` : ""
              }`
            : "",
          `${formatDate(from)} to ${formatDate(to)}${
            report.data ? ` · ${report.data.schoolDaysInRange} school days` : ""
          }`,
        ]}
        preparedBy={user.fullName}
      />

      <div className="print:hidden">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
        >
          <Link to={backTo}>
            <ArrowLeftIcon /> All people
          </Link>
        </Button>
      </div>

      <PageHeader
        className="print:hidden"
        title={
          <span className="flex items-center gap-3">
            {person ? (
              <Avatar name={person.fullName} size="lg" />
            ) : (
              <Skeleton className="size-12 rounded-full" />
            )}
            <span>
              <span className="block">{person?.fullName ?? "Loading…"}</span>
              {person && (
                <span className="tabular block text-sm font-normal text-muted-foreground">
                  {person.enrollNo}
                  {person.groupName && ` · ${person.groupName}`}
                  {person.tutorInitials && ` · Tutor ${person.tutorInitials}`}
                </span>
              )}
            </span>
          </span>
        }
        actions={
          <>
            <Field label="From">
              <Input
                type="date"
                className="tabular w-[10.5rem]"
                value={from}
                max={to}
                onChange={(e) =>
                  e.target.value && setParam("from", e.target.value)
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
                  e.target.value && setParam("to", e.target.value)
                }
              />
            </Field>
            <Button variant="outline" onClick={() => window.print()}>
              <PrinterIcon /> Print
            </Button>
            <Button asChild>
              <a href={exportUrl}>
                <DownloadIcon /> Export CSV
              </a>
            </Button>
          </>
        }
      />

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

      {report.isPending && <TableSkeleton rows={6} />}

      {report.isSuccess && (
        <>
          <Summary report={report.data} />

          <div className="grid gap-4 lg:grid-cols-[2fr_3fr] print:gap-3">
            <Card className="print:rounded-md print:border-black/20 print:break-inside-avoid">
              <CardHeader>
                <CardTitle>Arrival times</CardTitle>
              </CardHeader>
              <CardContent>
                {report.data.days.some((d) => d.firstIn) ? (
                  <Suspense fallback={<Skeleton className="h-44 w-full" />}>
                    <ArrivalChart days={report.data.days} />
                  </Suspense>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No arrivals in this range.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden print:rounded-none print:border-0 print:overflow-visible">
              <CardHeader>
                <CardTitle>Day by day</CardTitle>
              </CardHeader>
              {report.data.days.length === 0 ? (
                <EmptyState
                  title="Nothing recorded in this range."
                  detail="Days appear here once a scan arrives or an absence is decided."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">First in</TableHead>
                      <TableHead className="text-right">Last out</TableHead>
                      <TableHead className="text-right">Scans</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.data.days.map((day) => (
                      <TableRow key={day.id}>
                        <TableCell>{formatDate(day.date)}</TableCell>
                        <TableCell>
                          <StatusBadge status={day.status} />
                        </TableCell>
                        <TableCell
                          className={cn(
                            "tabular text-right",
                            !day.firstIn && "text-muted-foreground/60",
                          )}
                        >
                          {formatTime(day.firstIn)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "tabular text-right",
                            !day.lastOut && "text-muted-foreground/60",
                          )}
                        >
                          {day.lastOut ? formatTime(day.lastOut) : NO_TIME}
                        </TableCell>
                        <TableCell className="tabular text-right text-muted-foreground">
                          {day.scanCount}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {day.hasManualEdit && (
                            <span className="inline-flex items-center gap-1">
                              <PencilLineIcon className="size-3.5" /> Corrected
                              by hand
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Summary({ report }: { report: PersonReport }) {
  const s = report.summary;
  const tiles: Array<{ label: string; value: string; accent?: string }> = [
    { label: "School days", value: String(report.schoolDaysInRange) },
    {
      label: "Present",
      value: s ? String(s.daysPresent) : NO_TIME,
      accent: "text-status-onsite",
    },
    {
      label: "Absent",
      value: s ? String(s.daysAbsent) : NO_TIME,
      accent: "text-status-absent",
    },
    {
      label: "Late",
      value: s ? String(s.lateCount) : NO_TIME,
      accent: "text-status-late",
    },
    {
      label: "Attendance",
      value:
        s === null || s.attendancePercentage === null
          ? NO_TIME
          : `${s.attendancePercentage.toFixed(1)}%`,
    },
    {
      label: "Average arrival",
      value: s ? formatArrival(s.averageArrivalSeconds) : NO_TIME,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-xs md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          role="group"
          aria-label={tile.label}
          className="flex flex-col gap-1 bg-card p-3.5"
        >
          <span className="text-xs font-medium text-muted-foreground">
            {tile.label}
          </span>
          <span
            className={cn(
              "tabular text-2xl font-semibold tracking-tight",
              tile.accent,
            )}
          >
            {tile.value}
          </span>
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
