import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  CircleHelpIcon,
  ExternalLinkIcon,
  PencilLineIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { toast } from "sonner";
import { StatusBadge, StatusShape } from "@/components/status.js";
import { ErrorState } from "@/components/states.js";
import { Button } from "@/components/ui/button.js";
import { Field, Avatar, Skeleton } from "@/components/ui/misc.js";
import { Input, NativeSelect, Textarea } from "@/components/ui/input.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import {
  api,
  ApiError,
  type Adjustment,
  type CurrentUser,
  type DayStatus,
  type PersonDay,
  type PersonDetail,
  type PersonScan,
} from "@/lib/api.js";
import {
  formatDate,
  formatTime,
  isoToWallTime,
  NO_TIME,
  STATUS_PRESENTATION,
  wallTimeToIso,
} from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/**
 * One person, over the register rather than instead of it: losing your
 * place in a live view to read one person's detail is the wrong trade.
 * Escape closes it.
 */
export function PersonSheet({
  personId,
  date,
  onClose,
  onChanged,
}: {
  personId: string | null;
  date: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    // Non-modal, deliberately: the register stays readable and clickable
    // beside the panel, so the next person is one click away and a screen
    // reader still has the table. Escape and the close button dismiss it;
    // a click elsewhere does not.
    <Sheet
      modal={false}
      open={personId !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent
        className="w-full gap-0 border-l p-0 shadow-2xl sm:max-w-lg"
        onInteractOutside={(event) => event.preventDefault()}
      >
        {personId && (
          <PersonBody personId={personId} date={date} onChanged={onChanged} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PersonBody({
  personId,
  date,
  onChanged,
}: {
  personId: string;
  date: string;
  onChanged: () => void;
}) {
  const user = useOutletContext<CurrentUser>();
  const from = thirtyDaysBefore(date);

  const person = useQuery({
    queryKey: ["person", personId],
    queryFn: () => api.get<{ person: PersonDetail }>(`/api/people/${personId}`),
  });

  const history = useQuery({
    queryKey: ["person-scans", personId, from, date],
    queryFn: () =>
      api.get<{ scans: PersonScan[]; days: PersonDay[] }>(
        `/api/people/${personId}/scans?from=${from}&to=${date}`,
      ),
  });

  const today = history.data?.days.find((d) => d.date === date) ?? null;
  const todaysScans = (history.data?.scans ?? []).filter((s) =>
    s.attTimeLocal.startsWith(date),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3 border-b px-5 py-4">
        {person.data ? (
          <Avatar
            name={person.data.person.fullName}
            src={person.data.person.photoUrl}
            size="lg"
          />
        ) : (
          <Skeleton className="size-12 rounded-full" />
        )}
        <div className="min-w-0 flex-1">
          {/* The dialog is named by its title; the prefix keeps that name
              stable for assistive technology whoever is open. */}
          <SheetTitle className="truncate">
            <span className="sr-only">Person detail: </span>
            {person.data?.person.fullName ?? "Loading…"}
          </SheetTitle>
          <SheetDescription className="tabular truncate">
            {person.data && (
              <>
                {person.data.person.enrollNo}
                {person.data.person.groupName &&
                  ` · ${person.data.person.groupName}`}
                {person.data.person.category &&
                  ` · ${person.data.person.category}`}
              </>
            )}
          </SheetDescription>
          {today && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={today.status} isLate={today.isLate} />
              <span className="tabular text-xs text-muted-foreground">
                In {formatTime(today.firstIn)} · Out{" "}
                {today.lastOut ? formatTime(today.lastOut) : NO_TIME}
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {person.isError && (
          <ErrorState
            title="That person could not be loaded."
            detail="They may have been removed, or your session may have ended."
          />
        )}

        <Section title={`${formatDate(date)} — scans`}>
          <Timeline scans={todaysScans} isLoading={history.isPending} />
        </Section>

        {today && user.role === "full" && (
          <ManualAdjustment dayRecord={today} onChanged={onChanged} />
        )}

        <Section
          title="Last 30 days"
          action={
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link to={`/reports/person/${personId}?from=${from}&to=${date}`}>
                Full report <ExternalLinkIcon />
              </Link>
            </Button>
          }
        >
          <History
            days={history.data?.days ?? []}
            isLoading={history.isPending}
          />
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Timeline({
  scans,
  isLoading,
}: {
  scans: PersonScan[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }
  if (scans.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No scans recorded for this day.
      </p>
    );
  }
  return (
    <ol className="relative ml-2 space-y-3 border-l pl-4">
      {scans.map((scan) => {
        const Icon =
          scan.direction === "in"
            ? ArrowDownLeftIcon
            : scan.direction === "out"
              ? ArrowUpRightIcon
              : CircleHelpIcon;
        return (
          <li
            key={scan.id}
            className="relative flex items-center gap-3 text-sm"
          >
            <span
              className={cn(
                "absolute -left-[1.4rem] flex size-5 items-center justify-center rounded-full border bg-card",
                scan.direction === "in" &&
                  "border-status-onsite/40 text-status-onsite",
                scan.direction === "out" && "text-status-departed",
                scan.direction === "unknown" &&
                  "border-status-late/40 text-status-late",
              )}
            >
              <Icon className="size-3" />
            </span>
            <span className="tabular w-12 font-medium">
              {formatTime(scan.attTime)}
            </span>
            <span className="text-muted-foreground">
              {scan.direction === "in"
                ? "In"
                : scan.direction === "out"
                  ? "Out"
                  : "Unknown"}
            </span>
            <span className="truncate text-xs text-muted-foreground/70">
              {scan.deviceSerial}
              {/* How the direction was decided, so a surprising figure can be traced. */}
              {scan.directionSource !== "device" &&
                ` · by ${scan.directionSource}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Thirty days as a strip of squares — the shape of a month is read before
 * a single date is — with the list underneath for the detail.
 */
function History({
  days,
  isLoading,
}: {
  days: PersonDay[];
  isLoading: boolean;
}) {
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (days.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing recorded in this period.
      </p>
    );
  }
  const ordered = [...days].reverse();
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1" aria-hidden>
        {days.map((day) => (
          <Tooltip key={day.id}>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "size-3.5 rounded-[3px]",
                  STATUS_PRESENTATION[day.status].solid,
                  day.status === "not_expected" &&
                    "border border-dashed border-status-idle bg-transparent",
                  day.isLate &&
                    day.status !== "late" &&
                    "ring-2 ring-status-late/60 ring-inset",
                )}
              />
            </TooltipTrigger>
            <TooltipContent>
              {formatDate(day.date)} · {STATUS_PRESENTATION[day.status].label}
              {day.isLate ? " · late" : ""}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <ul className="divide-y">
        {ordered.map((day) => (
          <li key={day.id} className="flex items-center gap-3 py-1.5 text-sm">
            <StatusShape status={day.status} />
            <span className="w-24 shrink-0">{formatDate(day.date)}</span>
            <span className="tabular w-24 shrink-0 text-muted-foreground">
              {formatTime(day.firstIn)}–
              {day.lastOut ? formatTime(day.lastOut) : NO_TIME}
            </span>
            <span className="text-xs text-muted-foreground">
              {STATUS_PRESENTATION[day.status].label}
              {day.isLate && day.status !== "late" ? " · late" : ""}
            </span>
            {day.hasManualEdit && (
              <PencilLineIcon
                aria-label="Corrected by hand"
                className="ml-auto size-3.5 text-primary/70"
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Editing a day requires a reason. The panel shows who last edited it. */
function ManualAdjustment({
  dayRecord,
  onChanged,
}: {
  dayRecord: PersonDay;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DayStatus>(dayRecord.status);
  const [firstIn, setFirstIn] = useState(isoToWallTime(dayRecord.firstIn));
  const [lastOut, setLastOut] = useState(isoToWallTime(dayRecord.lastOut));
  const [reason, setReason] = useState("");

  // A time is sent only if it was changed; "" means cleared. The status is
  // nudged to agree with the times unless the administrator has chosen it
  // themselves — a first-in makes an absent day on site, a last-out makes
  // it departed — so the two cannot quietly contradict each other.
  const changeFirstIn = (value: string) => {
    setFirstIn(value);
    if (value && (status === "absent" || status === "not_expected"))
      setStatus(lastOut ? "departed" : "on_site");
  };
  const changeLastOut = (value: string) => {
    setLastOut(value);
    if (value && status === "on_site") setStatus("departed");
    if (!value && status === "departed") setStatus("on_site");
  };
  const body = () => {
    const out: Record<string, unknown> = { status, reason };
    if (firstIn !== isoToWallTime(dayRecord.firstIn))
      out["firstIn"] = firstIn ? wallTimeToIso(dayRecord.date, firstIn) : null;
    if (lastOut !== isoToWallTime(dayRecord.lastOut))
      out["lastOut"] = lastOut ? wallTimeToIso(dayRecord.date, lastOut) : null;
    return out;
  };
  const timesInOrder =
    !firstIn || !lastOut || firstIn <= lastOut;

  const adjustments = useQuery({
    queryKey: ["adjustments", dayRecord.id],
    queryFn: () =>
      api.get<{ adjustments: Adjustment[] }>(
        `/api/day-records/${dayRecord.id}/adjustments`,
      ),
    enabled: dayRecord.hasManualEdit || open,
  });

  const mutation = useMutation({
    mutationFn: () => api.patch(`/api/day-records/${dayRecord.id}`, body()),
    onSuccess: () => {
      setOpen(false);
      setReason("");
      void queryClient.invalidateQueries({
        queryKey: ["adjustments", dayRecord.id],
      });
      // The header and the history read the day back from this query.
      void queryClient.invalidateQueries({ queryKey: ["person-scans"] });
      toast.success("Correction saved", {
        description: "It is recorded against your name in the audit log.",
      });
      onChanged();
    },
  });

  const last = adjustments.data?.adjustments.at(-1);

  return (
    <section className="mb-6 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
          Correct this day
        </h3>
        {!open && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <PencilLineIcon /> Correct
          </Button>
        )}
      </div>

      {last && (
        <p className="mt-2 text-xs text-muted-foreground">
          Last corrected by {last.byName ?? "a removed account"} on{" "}
          {formatDate(new Date(last.createdAt))}: “{last.reason}”
        </p>
      )}

      {open && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="First in" hint="Blank for none.">
              <Input
                type="time"
                className="tabular"
                value={firstIn}
                onChange={(e) => changeFirstIn(e.target.value)}
              />
            </Field>
            <Field label="Last out" hint="Blank for still on site.">
              <Input
                type="time"
                className="tabular"
                value={lastOut}
                onChange={(e) => changeLastOut(e.target.value)}
              />
            </Field>
          </div>
          {!timesInOrder && (
            <p role="alert" className="text-sm text-status-absent">
              The last out is before the first in.
            </p>
          )}

          <Field label="Status">
            <NativeSelect
              value={status}
              onChange={(e) => setStatus(e.target.value as DayStatus)}
            >
              <option value="on_site">Present</option>
              <option value="departed">Departed</option>
              <option value="absent">Absent</option>
              <option value="not_expected">Not expected</option>
            </NativeSelect>
          </Field>

          <Field
            label="Reason"
            hint="Required. Anyone reading this later should understand why the record was changed."
          >
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={3}
              placeholder="Signed out at reception; the reader missed it."
            />
          </Field>

          {mutation.isError && (
            <p role="alert" className="text-sm text-status-absent">
              {mutation.error instanceof ApiError
                ? mutation.error.message
                : "The correction was not saved."}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={
                mutation.isPending || reason.trim().length < 3 || !timesInOrder
              }
            >
              {mutation.isPending ? "Saving…" : "Save correction"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function thirtyDaysBefore(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}
