import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import type { RegisterRow } from "../lib/api.js";
import { formatTime, NO_TIME } from "../lib/format.js";
import { StatusBadge } from "./primitives.js";

/**
 * The register table.
 *
 * Virtualised: the school is over a thousand rows and this screen has to
 * stay responsive while scans are arriving.
 *
 * A row that has just changed carries a brief highlight. That is the only
 * motion in the application that the user did not ask for, and it is gone
 * in a second and a half.
 */

export interface RegisterTableProps {
  rows: RegisterRow[];
  /** Person ids changed recently, for the highlight. */
  recentlyChanged: ReadonlySet<string>;
  showTutor: boolean;
  selectedPersonId: string | null;
  onSelect: (personId: string) => void;
  scrollToPersonId: string | null;
  onScrolledTo: () => void;
}

const ROW_HEIGHT = 40;

export function RegisterTable({
  rows,
  recentlyChanged,
  showTutor,
  selectedPersonId,
  onSelect,
  scrollToPersonId,
  onScrolledTo,
}: RegisterTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualiser = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  useEffect(() => {
    if (!scrollToPersonId) return;
    const index = rows.findIndex((r) => r.personId === scrollToPersonId);
    if (index >= 0) virtualiser.scrollToIndex(index, { align: "center" });
    onScrolledTo();
  }, [scrollToPersonId, rows, virtualiser, onScrolledTo]);

  const gridTemplate = showTutor
    ? "minmax(12rem,2fr) 6rem minmax(7rem,1fr) 4.5rem 5rem 5rem minmax(9rem,auto)"
    : "minmax(12rem,2fr) 6rem minmax(7rem,1fr) 5rem 5rem minmax(9rem,auto)";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header, outside the scroll area so it stays put. */}
      <div
        role="row"
        className="grid shrink-0 items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-600"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <span>Name</span>
        <span>ID</span>
        <span>Group</span>
        {showTutor && <span>Tutor</span>}
        <span className="text-right">First in</span>
        <span className="text-right">Last out</span>
        <span>Status</span>
      </div>

      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto"
        tabIndex={0}
      >
        <div
          style={{ height: virtualiser.getTotalSize(), position: "relative" }}
        >
          {virtualiser.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]!;
            const changed = recentlyChanged.has(row.personId);
            const selected = selectedPersonId === row.personId;
            return (
              <div
                key={row.personId}
                role="row"
                tabIndex={0}
                aria-selected={selected}
                onClick={() => onSelect(row.personId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(row.personId);
                  }
                }}
                className={`absolute left-0 grid w-full cursor-pointer items-center gap-3 border-b border-neutral-100 px-3 text-sm hover:bg-neutral-50 ${
                  selected ? "bg-brand-50" : ""
                } ${changed ? "animate-rowFlash reduced-flash" : ""}`}
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                  gridTemplateColumns: gridTemplate,
                }}
              >
                <span className="flex items-center gap-1.5 truncate font-medium text-neutral-800">
                  {row.fullName}
                  {row.hasManualEdit && (
                    <span
                      title="This day was corrected by hand"
                      aria-label="Corrected by hand"
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400"
                    />
                  )}
                </span>
                <span className="tabular truncate text-neutral-500">
                  {row.enrollNo}
                </span>
                <span className="truncate text-neutral-600">
                  {row.groupName ?? "—"}
                </span>
                {showTutor && (
                  <span className="truncate text-neutral-500">
                    {row.tutorInitials ?? "—"}
                  </span>
                )}
                <span
                  className={`tabular text-right ${row.firstIn ? "text-neutral-800" : "text-neutral-400"}`}
                >
                  {formatTime(row.firstIn)}
                </span>
                <span
                  className={`tabular text-right ${row.lastOut ? "text-neutral-800" : "text-neutral-400"}`}
                >
                  {row.lastOut ? formatTime(row.lastOut) : NO_TIME}
                </span>
                <span>
                  <StatusBadge status={row.status} isLate={row.isLate} />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The cards shown instead of the table below 768px. */
export function RegisterCards({
  rows,
  recentlyChanged,
  onSelect,
}: Pick<RegisterTableProps, "rows" | "recentlyChanged" | "onSelect">) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {rows.map((row) => (
        <button
          key={row.personId}
          onClick={() => onSelect(row.personId)}
          className={`mb-2 w-full rounded border border-neutral-200 bg-white p-3 text-left ${
            recentlyChanged.has(row.personId)
              ? "animate-rowFlash reduced-flash"
              : ""
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-neutral-800">
                {row.fullName}
              </p>
              <p className="tabular text-xs text-neutral-500">
                {row.enrollNo} · {row.groupName ?? "No group"}
              </p>
            </div>
            <StatusBadge status={row.status} isLate={row.isLate} />
          </div>
          <div className="tabular mt-2 flex gap-4 text-xs text-neutral-600">
            <span>In {formatTime(row.firstIn)}</span>
            <span>Out {row.lastOut ? formatTime(row.lastOut) : NO_TIME}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
