import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { RegisterRow, StatusCounts } from "@/lib/api.js";
import { DEFAULT_STATUS, type StatusFilter } from "@/lib/filters.js";
import { schoolTimezone } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

// The charting library is heavy and this is the first screen; it arrives
// a moment after the numbers do.
const ArrivalsSparkline = lazy(() => import("@/components/charts/ArrivalsSparkline.js"));

/**
 * The numbers above the table, and the shape of the morning.
 *
 * Clicking a count applies it as a status filter — the fastest way to
 * answer "who is absent?" is to press the number next to the word. The
 * counts pulse when they change so a shift is noticed peripherally by
 * someone who is not looking directly at the screen, which is the usual
 * case for a display on a wall.
 */

const TILES: Array<{
  key: keyof StatusCounts;
  label: string;
  filter: StatusFilter;
  accent: string;
  bar: string;
}> = [
  {
    key: "expected",
    label: "Expected",
    filter: "any",
    accent: "",
    bar: "bg-foreground/70",
  },
  {
    key: "on_site",
    label: "Present",
    filter: "on_site",
    accent: "text-status-onsite",
    bar: "bg-status-onsite",
  },
  {
    key: "late",
    label: "Late",
    filter: "late",
    accent: "text-status-late",
    bar: "bg-status-late",
  },
  {
    key: "absent",
    label: "Absent",
    filter: "absent",
    accent: "text-status-absent",
    bar: "bg-status-absent",
  },
  {
    key: "departed",
    label: "Departed",
    filter: "departed",
    accent: "text-status-departed",
    bar: "bg-status-departed",
  },
];

export function StatCards({
  counts,
  rows,
  activeStatus,
  onSelectStatus,
  isLoading,
}: {
  counts: StatusCounts | undefined;
  rows: RegisterRow[];
  activeStatus: StatusFilter;
  onSelectStatus: (status: StatusFilter) => void;
  isLoading: boolean;
}) {
  // Shares are of the people expected today; when nobody is — a Sunday,
  // or a calendar not yet entered — of the roll in view.
  const total = counts?.expected || counts?.total || 0;
  return (
    // One surface, hairlines between the numbers: six figures read as one
    // line of thought, not six boxes competing for attention.
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-xs md:grid-cols-3 xl:grid-cols-7">
      {TILES.map((tile) => {
        const value = counts?.[tile.key] ?? 0;
        const active = activeStatus === tile.filter;
        const share =
          total > 0 && tile.key !== "expected" ? (value / total) * 100 : 100;
        return (
          <button
            key={tile.key}
            type="button"
            aria-pressed={active}
            // A second click on a tile returns to the resting view.
            onClick={() =>
              onSelectStatus(active ? DEFAULT_STATUS : tile.filter)
            }
            disabled={isLoading}
            className={cn(
              "group flex flex-col gap-1 bg-card p-3.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset disabled:cursor-default",
              active && "bg-accent/70 hover:bg-accent/70",
            )}
          >
            <span className="text-xs font-medium text-muted-foreground">
              {tile.label}
            </span>
            <AnimatedCount
              value={value}
              className={cn(
                "tabular text-2xl font-semibold tracking-tight",
                tile.accent,
              )}
            />
            <span className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
              <span
                className={cn(
                  "block h-full rounded-full transition-[width] duration-500",
                  tile.bar,
                )}
                style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
              />
            </span>
          </button>
        );
      })}
      {/* Six cells: 2×3 on a phone, 3×2 on a tablet, one row of seven with
          the curve given two columns on a desk. Never a gap. */}
      <ArrivalsCard rows={rows} className="xl:col-span-2" />
    </div>
  );
}

/** Pulses when the number changes, and not on first render. */
function AnimatedCount({
  value,
  className,
}: {
  value: number;
  className: string;
}) {
  const previous = useRef(value);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setPulse(true);
    const timer = window.setTimeout(() => setPulse(false), 420);
    return () => window.clearTimeout(timer);
  }, [value]);
  return (
    <span
      className={cn(
        className,
        "inline-block origin-left",
        pulse && "animate-count-pulse",
      )}
    >
      {value.toLocaleString("en-GB")}
    </span>
  );
}

/**
 * Arrivals by ten-minute slot, from the rows on screen. Nothing is fetched
 * for it; it is the register's own data seen from above. It answers the
 * question a head asks at 08:30 — "how many are still to come?" — without
 * a number having to be looked for.
 */
function ArrivalsCard({
  rows,
  className,
}: {
  rows: RegisterRow[];
  className?: string;
}) {
  const series = useMemo(() => bucketArrivals(rows), [rows]);
  const arrived = series.reduce((sum, b) => sum + b.count, 0);
  const peak = series.reduce<(typeof series)[number] | null>(
    (best, b) => (b.count > (best?.count ?? 0) ? b : best),
    null,
  );

  return (
    <div
      className={cn("flex flex-col bg-card p-3.5", className)}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Arrivals
        </span>
        {peak && peak.count > 0 && (
          <span className="tabular text-xs text-muted-foreground">
            peak {peak.label}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span className="tabular text-2xl font-semibold tracking-tight">
          {arrived}
        </span>
        <div className="h-9 w-full max-w-[60%]" aria-hidden>
          {arrived > 0 ? (
            <Suspense fallback={<div className="h-full w-full rounded bg-muted/40" />}>
              <ArrivalsSparkline series={series} />
            </Suspense>
          ) : (
            <div className="flex h-full items-end">
              <div className="h-px w-full bg-border" />
            </div>
          )}
        </div>
      </div>
      <span className="mt-1 text-xs text-muted-foreground">
        {arrived === 0
          ? "No arrivals yet"
          : `${arrived} arrived, by ten-minute slot`}
      </span>
    </div>
  );
}

function bucketArrivals(
  rows: RegisterRow[],
): Array<{ label: string; count: number }> {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: schoolTimezone(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const minutes: number[] = [];
  for (const row of rows) {
    if (!row.firstIn) continue;
    const [h, m] = clock.format(new Date(row.firstIn)).split(":").map(Number);
    if (h === undefined || m === undefined || Number.isNaN(h)) continue;
    minutes.push(h * 60 + m);
  }
  if (minutes.length === 0) return [];
  const start = Math.floor(Math.min(...minutes) / 10) * 10;
  const end = Math.floor(Math.max(...minutes) / 10) * 10;
  const buckets: Array<{ label: string; count: number }> = [];
  for (let t = start; t <= end; t += 10) {
    buckets.push({
      label: `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`,
      count: 0,
    });
  }
  for (const minute of minutes) {
    const index = Math.floor((minute - start) / 10);
    const bucket = buckets[index];
    if (bucket) bucket.count += 1;
  }
  return buckets;
}
