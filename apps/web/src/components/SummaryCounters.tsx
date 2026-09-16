import { useEffect, useRef, useState } from "react";
import type { DayStatus, StatusCounts } from "../lib/api.js";
import { STATUS_PRESENTATION } from "../lib/format.js";

/**
 * The counters above the table.
 *
 * Clicking one applies it as a status filter — the fastest way to answer
 * "who is absent?" is to press the number next to the word.
 *
 * They pulse when they change so a shift is noticed peripherally by someone
 * who is not looking directly at the screen, which is the usual case for a
 * display on a wall.
 */

export interface SummaryCountersProps {
  counts: StatusCounts | undefined;
  activeStatus: DayStatus | null;
  onSelectStatus: (status: DayStatus | null) => void;
}

const TILES: Array<{ key: DayStatus | "total" | "late"; label: string }> = [
  { key: "total", label: "Total" },
  { key: "on_site", label: "On site" },
  { key: "departed", label: "Departed" },
  { key: "late", label: "Late" },
  { key: "absent", label: "Absent" },
];

export function SummaryCounters({
  counts,
  activeStatus,
  onSelectStatus,
}: SummaryCountersProps) {
  return (
    <div className="flex shrink-0 flex-wrap gap-2 px-3 py-2">
      {TILES.map((tile) => {
        const value = counts?.[tile.key] ?? 0;
        const isFilterable = tile.key !== "total" && tile.key !== "late";
        const isActive = isFilterable && activeStatus === tile.key;
        const accent =
          tile.key === "total" || tile.key === "late"
            ? tile.key === "late"
              ? "text-status-late"
              : "text-neutral-700"
            : STATUS_PRESENTATION[tile.key].className.split(" ")[0];

        return (
          <button
            key={tile.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              if (tile.key === "total") return onSelectStatus(null);
              if (tile.key === "late") return;
              onSelectStatus(isActive ? null : (tile.key as DayStatus));
            }}
            disabled={tile.key === "late"}
            className={`min-w-[6.5rem] rounded border px-3 py-2 text-left transition-colors ${
              isActive
                ? "border-brand-400 bg-brand-50"
                : "border-neutral-200 bg-white hover:border-neutral-300"
            } ${tile.key === "late" ? "cursor-default" : ""}`}
          >
            <AnimatedCount
              value={value}
              className={`tabular text-xl font-semibold ${accent}`}
            />
            <span className="block text-xs text-neutral-500">{tile.label}</span>
          </button>
        );
      })}
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
    const timer = window.setTimeout(() => setPulse(false), 400);
    return () => window.clearTimeout(timer);
  }, [value]);

  return (
    <span
      className={`${className} inline-block ${pulse ? "animate-countPulse" : ""}`}
    >
      {value.toLocaleString("en-GB")}
    </span>
  );
}
