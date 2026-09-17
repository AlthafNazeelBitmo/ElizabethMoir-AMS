import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.js";
import { Input, NativeSelect } from "@/components/ui/input.js";
import { Checkbox, Field, Skeleton } from "@/components/ui/misc.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { api } from "@/lib/api.js";
import { formatDate, schoolToday } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";
import { Note, Panel, Problem, Section } from "./shared.js";

interface CalendarDay {
  date: string;
  type: "school_day" | "weekend" | "holiday" | "exception";
  label: string | null;
}

const TYPE: Record<
  CalendarDay["type"],
  { label: string; cell: string; dot: string }
> = {
  school_day: {
    label: "School day",
    cell: "bg-accent text-accent-foreground",
    dot: "bg-primary",
  },
  weekend: {
    label: "Weekend",
    cell: "bg-muted/60 text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
  holiday: {
    label: "Holiday",
    cell: "bg-status-absent-bg text-status-absent",
    dot: "bg-status-absent",
  },
  exception: {
    label: "Exception",
    cell: "bg-status-late-bg text-status-late",
    dot: "bg-status-late",
  },
};

/**
 * The calendar decides what absence means.
 *
 * A date nobody has entered is not a school day, so an empty calendar
 * produces no absences at all. That is the safe way round — a missing
 * absence is a gap, an invented one is an accusation about a child — but it
 * does mean this screen has to be used before absence reporting says
 * anything at all.
 */
export function AdminCalendar() {
  const queryClient = useQueryClient();
  const today = schoolToday();
  const [month, setMonth] = useState(today.slice(0, 7));

  const from = `${month}-01`;
  const to = endOfMonth(month);

  const days = useQuery({
    queryKey: ["admin-calendar", from, to],
    queryFn: () =>
      api.get<{ days: CalendarDay[] }>(
        `/api/admin/calendar?from=${from}&to=${to}`,
      ),
  });

  const set = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post("/api/admin/calendar", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });
      toast.success("Calendar updated");
    },
  });

  const byDate = useMemo(
    () => new Map((days.data?.days ?? []).map((d) => [d.date, d])),
    [days.data],
  );
  const labelled = (days.data?.days ?? []).filter((d) => d.label);
  const schoolDays = (days.data?.days ?? []).filter(
    (d) => d.type === "school_day" || d.type === "exception",
  ).length;

  return (
    <Section
      title="Calendar"
      description="Which dates are school days. Absence is only counted on these, so a date that is not here counts for nobody and nothing is ever marked absent by mistake."
    >
      <Problem error={set.error} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel
          title={monthName(month)}
          description={
            days.isSuccess
              ? `${schoolDays} school ${schoolDays === 1 ? "day" : "days"}`
              : undefined
          }
          actions={
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous month"
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMonth(today.slice(0, 7))}
              >
                This month
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next month"
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                <ChevronRightIcon />
              </Button>
            </div>
          }
        >
          <div className="p-4">
            {days.isPending ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <MonthGrid month={month} byDate={byDate} today={today} />
            )}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {(Object.keys(TYPE) as CalendarDay["type"][]).map((type) => (
                <span key={type} className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", TYPE[type].dot)} />
                  {TYPE[type].label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full border border-dashed border-muted-foreground/60" />
                Not set
              </span>
            </div>
          </div>

          {labelled.length > 0 && (
            <div className="border-t px-4 py-3">
              <h3 className="mb-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
                Named days
              </h3>
              <ul className="space-y-1 text-sm">
                {labelled.map((d) => (
                  <li key={d.date} className="flex items-center gap-2">
                    <span
                      className={cn("size-2 rounded-full", TYPE[d.type].dot)}
                    />
                    <span className="w-28 text-muted-foreground">
                      {formatDate(d.date)}
                    </span>
                    <span>{d.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel
          title="Set days"
          description="Mark a range in one go; weekends are skipped unless you say otherwise."
        >
          <form
            className="space-y-3 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const label = String(data.get("label") ?? "");
              set.mutate({
                from: String(data.get("from")),
                to: String(data.get("to")),
                type: String(data.get("type")),
                ...(label ? { label } : {}),
                weekdaysOnly: data.get("weekdaysOnly") === "on",
              });
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                <Input
                  name="from"
                  type="date"
                  required
                  defaultValue={from}
                  className="tabular"
                />
              </Field>
              <Field label="To">
                <Input
                  name="to"
                  type="date"
                  required
                  defaultValue={to}
                  className="tabular"
                />
              </Field>
            </div>
            <Field label="As">
              <NativeSelect
                name="type"
                defaultValue="school_day"
                className="w-full"
              >
                <option value="school_day">School day</option>
                <option value="holiday">Holiday</option>
                <option value="weekend">Weekend</option>
                <option value="exception">Exception</option>
              </NativeSelect>
            </Field>
            <Field label="Label (optional)">
              <Input name="label" placeholder="Poya day" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="weekdaysOnly" defaultChecked />
              Weekdays only
            </label>
            <Button type="submit" className="w-full" disabled={set.isPending}>
              {set.isPending ? "Setting…" : "Set these days"}
            </Button>
          </form>
          <div className="border-t px-4 py-3">
            <Note>
              Until a date is marked a school day, nobody can be absent on it.
              Set the term as school days first, then carve out the holidays.
            </Note>
          </div>
        </Panel>
      </div>
    </Section>
  );
}

function MonthGrid({
  month,
  byDate,
  today,
}: {
  month: string;
  byDate: Map<string, CalendarDay>;
  today: string;
}) {
  const first = new Date(`${month}-01T12:00:00Z`);
  const daysInMonth = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  // Monday first, since a school week does.
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: Array<string | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
    ),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="grid grid-cols-7 gap-1">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
        <div
          key={d}
          className="pb-1 text-center text-[0.6875rem] font-medium text-muted-foreground"
        >
          {d}
        </div>
      ))}
      {cells.map((date, i) => {
        if (!date) return <div key={`blank-${i}`} />;
        const day = byDate.get(date);
        const cell = (
          <div
            className={cn(
              "tabular flex aspect-square flex-col items-start justify-between rounded-md border border-transparent p-1.5 text-sm",
              day
                ? TYPE[day.type].cell
                : "border-dashed border-border text-muted-foreground/70",
              date === today &&
                "ring-2 ring-primary/50 ring-offset-1 ring-offset-card",
            )}
          >
            <span className={cn(date === today && "font-semibold")}>
              {Number(date.slice(8))}
            </span>
            {day?.label && (
              <span className="w-full truncate text-[0.625rem] leading-tight opacity-80">
                {day.label}
              </span>
            )}
          </div>
        );
        return (
          <Tooltip key={date}>
            <TooltipTrigger asChild>{cell}</TooltipTrigger>
            <TooltipContent>
              {formatDate(date)} · {day ? TYPE[day.type].label : "Not set"}
              {day?.label ? ` · ${day.label}` : ""}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function endOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthName(month: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
}
