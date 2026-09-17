import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  ApiError,
  type Adjustment,
  type DayStatus,
  type PersonDay,
  type PersonDetail,
  type PersonScan,
} from "../lib/api.js";
import { formatDate, formatTime, NO_TIME } from "../lib/format.js";
import {
  Button,
  ErrorState,
  Field,
  inputClass,
  StatusBadge,
} from "./primitives.js";

/**
 * The person panel.
 *
 * A panel over the register rather than a route of its own: losing your
 * place in a live view to read one person's detail is the wrong trade.
 * Escape closes it.
 */

export interface PersonPanelProps {
  personId: string;
  date: string;
  onClose: () => void;
  onChanged: () => void;
}

export function PersonPanel({
  personId,
  date,
  onClose,
  onChanged,
}: PersonPanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  return (
    <aside
      role="dialog"
      aria-label="Person detail"
      className="flex h-full w-full max-w-md shrink-0 flex-col border-l border-neutral-200 bg-white"
    >
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-neutral-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-brand-700">
            {person.data?.person.fullName ?? "Loading…"}
          </h2>
          {person.data && (
            <p className="tabular truncate text-xs text-neutral-500">
              {person.data.person.enrollNo}
              {person.data.person.groupName &&
                ` · ${person.data.person.groupName}`}
              {person.data.person.tutorInitials &&
                ` · ${person.data.person.tutorInitials}`}
            </p>
          )}
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close panel">
          Close
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {person.isError && (
          <ErrorState
            title="That person could not be loaded."
            detail="They may have been removed, or your session may have ended."
          />
        )}

        {today && (
          <section className="mb-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {formatDate(date)}
            </h3>
            <div className="flex items-center gap-3">
              <StatusBadge status={today.status} isLate={today.isLate} />
              <span className="tabular text-sm text-neutral-600">
                In {formatTime(today.firstIn)} · Out{" "}
                {today.lastOut ? formatTime(today.lastOut) : NO_TIME}
              </span>
            </div>
          </section>
        )}

        <section className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Today's scans
          </h3>
          <Timeline
            scans={(history.data?.scans ?? []).filter((s) =>
              s.attTimeLocal.startsWith(date),
            )}
          />
        </section>

        {today && <ManualAdjustment dayRecord={today} onChanged={onChanged} />}

        <section className="mb-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Last 30 days
            </h3>
            <Link
              to={`/reports/person/${personId}?from=${from}&to=${date}`}
              className="text-xs text-brand-700 hover:underline"
            >
              Full report
            </Link>
          </div>
          <History days={history.data?.days ?? []} />
        </section>
      </div>
    </aside>
  );
}

function Timeline({ scans }: { scans: PersonScan[] }) {
  if (scans.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No scans recorded for this day.
      </p>
    );
  }
  return (
    <ol className="space-y-1.5">
      {scans.map((scan) => (
        <li key={scan.id} className="flex items-center gap-2 text-sm">
          <span className="tabular w-12 text-neutral-800">
            {formatTime(scan.attTime)}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
              scan.direction === "in"
                ? "bg-brand-50 text-brand-700"
                : scan.direction === "out"
                  ? "bg-neutral-100 text-neutral-600"
                  : "bg-amber-50 text-status-late"
            }`}
          >
            {scan.direction === "in"
              ? "In"
              : scan.direction === "out"
                ? "Out"
                : "Unknown"}
          </span>
          <span className="truncate text-xs text-neutral-400">
            {scan.deviceSerial}
            {/* How the direction was decided, so a surprising figure can be traced. */}
            {scan.directionSource !== "device" &&
              ` · by ${scan.directionSource}`}
          </span>
        </li>
      ))}
    </ol>
  );
}

function History({ days }: { days: PersonDay[] }) {
  if (days.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Nothing recorded in this period.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {[...days].reverse().map((day) => (
        <li key={day.id} className="flex items-center gap-2 text-sm">
          <span className="w-24 shrink-0 text-neutral-600">
            {formatDate(day.date)}
          </span>
          <span className="tabular w-24 shrink-0 text-neutral-500">
            {formatTime(day.firstIn)}–
            {day.lastOut ? formatTime(day.lastOut) : NO_TIME}
          </span>
          <StatusBadge status={day.status} isLate={day.isLate} />
          {day.hasManualEdit && (
            <span
              title="Corrected by hand"
              aria-label="Corrected by hand"
              className="inline-block h-1.5 w-1.5 rounded-full bg-brand-400"
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Editing a time requires a reason. The panel shows who last edited it. */
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
  const [reason, setReason] = useState("");

  const adjustments = useQuery({
    queryKey: ["adjustments", dayRecord.id],
    queryFn: () =>
      api.get<{ adjustments: Adjustment[] }>(
        `/api/day-records/${dayRecord.id}/adjustments`,
      ),
    enabled: dayRecord.hasManualEdit || open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/day-records/${dayRecord.id}`, { status, reason }),
    onSuccess: () => {
      setOpen(false);
      setReason("");
      void queryClient.invalidateQueries({
        queryKey: ["adjustments", dayRecord.id],
      });
      onChanged();
    },
  });

  const last = adjustments.data?.adjustments.at(-1);

  return (
    <section className="mb-5 rounded border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Correct this day
        </h3>
        {!open && (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Correct
          </Button>
        )}
      </div>

      {last && (
        <p className="mt-2 text-xs text-neutral-500">
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
          <Field label="Status">
            <select
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as DayStatus)}
            >
              <option value="on_site">On site</option>
              <option value="departed">Departed</option>
              <option value="absent">Absent</option>
              <option value="not_expected">Not expected</option>
            </select>
          </Field>

          <Field
            label="Reason"
            hint="Required. Anyone reading this later should understand why the record was changed."
          >
            <textarea
              className={`${inputClass} min-h-[4rem]`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={3}
              placeholder="Signed out at reception; the reader missed it."
            />
          </Field>

          {mutation.isError && (
            <p className="text-sm text-status-absent">
              {mutation.error instanceof ApiError
                ? mutation.error.message
                : "The correction was not saved."}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={mutation.isPending || reason.trim().length < 3}
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
