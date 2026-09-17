import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Field, inputClass } from "../primitives.js";
import { api } from "../../lib/api.js";
import { Problem, Section, Table } from "./shared.js";
import { formatDate, schoolToday } from "../../lib/format.js";

interface CalendarDay {
  date: string;
  type: "school_day" | "weekend" | "holiday" | "exception";
  label: string | null;
}

const TYPE_LABEL: Record<CalendarDay["type"], string> = {
  school_day: "School day",
  weekend: "Weekend",
  holiday: "Holiday",
  exception: "Exception",
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
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(`${today.slice(0, 7)}-28`);

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
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["admin-calendar"] }),
  });

  return (
    <Section
      title="Calendar"
      description="Which dates are school days. Absence is only counted on these, so a date that is not here counts for nobody and nothing is ever marked absent by mistake."
    >
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="Showing from">
          <input
            type="date"
            className={inputClass}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="to">
          <input
            type="date"
            className={inputClass}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>

      <form
        className="mb-4 flex flex-wrap items-end gap-2 rounded border border-neutral-200 p-3"
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
        <Field label="Set from">
          <input
            name="from"
            type="date"
            required
            defaultValue={from}
            className={inputClass}
          />
        </Field>
        <Field label="to">
          <input
            name="to"
            type="date"
            required
            defaultValue={to}
            className={inputClass}
          />
        </Field>
        <Field label="as">
          <select name="type" className={inputClass} defaultValue="school_day">
            <option value="school_day">School day</option>
            <option value="holiday">Holiday</option>
            <option value="weekend">Weekend</option>
            <option value="exception">Exception</option>
          </select>
        </Field>
        <Field label="Label (optional)">
          <input name="label" className={inputClass} placeholder="Poya day" />
        </Field>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-neutral-700">
          <input name="weekdaysOnly" type="checkbox" defaultChecked />
          Weekdays only
        </label>
        <Button type="submit" variant="primary" disabled={set.isPending}>
          {set.isPending ? "Setting…" : "Set these days"}
        </Button>
      </form>

      <Problem error={set.error} />

      {days.isPending && <p className="text-sm text-neutral-500">Loading…</p>}

      {days.isSuccess && days.data.days.length === 0 && (
        <p className="text-sm text-neutral-500">
          No days set in this range. Until a date is marked a school day, nobody
          can be absent on it — set the term above.
        </p>
      )}

      {days.isSuccess && days.data.days.length > 0 && (
        <Table
          head={
            <>
              <th className="py-2">Date</th>
              <th className="py-2">Type</th>
              <th className="py-2">Label</th>
            </>
          }
        >
          {days.data.days.map((day) => (
            <tr key={day.date} className="border-b border-neutral-100">
              <td className="py-1.5">{formatDate(day.date)}</td>
              <td className="py-1.5 text-neutral-600">
                {TYPE_LABEL[day.type]}
              </td>
              <td className="py-1.5 text-neutral-500">{day.label ?? "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}
