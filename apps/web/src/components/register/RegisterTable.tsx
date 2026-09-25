import { useVirtualizer } from "@tanstack/react-virtual";
import { PencilLineIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { CategoryTag, StatusBadge } from "@/components/status.js";
import { Avatar } from "@/components/ui/misc.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import type { RegisterRow } from "@/lib/api.js";
import { formatTime, NO_TIME } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

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
  /** Tighter columns for a tablet, where the groups rail is gone. */
  compact?: boolean;
  selectedPersonId: string | null;
  onSelect: (personId: string) => void;
  scrollToPersonId: string | null;
  onScrolledTo: () => void;
}

const ROW_HEIGHT = 44;

export function RegisterTable({
  rows,
  recentlyChanged,
  showTutor,
  compact = false,
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

  // Every column has a floor and a share of whatever is left: on a laptop
  // they all sit at their floors, and on a wide screen the room is spread
  // across the row rather than piling up behind the group while the times
  // and the status huddle at the right edge. The group's floor is where
  // "Senior Staff" and "Extra-Curricular" fit side by side.
  const gridTemplate = compact
    ? showTutor
      ? "minmax(10rem,2fr) minmax(4.5rem,0.6fr) minmax(9.5rem,1.3fr) minmax(3rem,0.5fr) minmax(4.25rem,0.8fr) minmax(4.25rem,0.8fr) minmax(8rem,1fr)"
      : "minmax(10rem,2fr) minmax(4.5rem,0.6fr) minmax(9.5rem,1.3fr) minmax(4.25rem,0.8fr) minmax(4.25rem,0.8fr) minmax(8rem,1fr)"
    : showTutor
      ? "minmax(12rem,2fr) minmax(5.5rem,0.6fr) minmax(11rem,1.3fr) minmax(4rem,0.5fr) minmax(5rem,0.8fr) minmax(5rem,0.8fr) minmax(8.5rem,1fr)"
      : "minmax(12rem,2fr) minmax(5.5rem,0.6fr) minmax(11rem,1.3fr) minmax(5rem,0.8fr) minmax(5rem,0.8fr) minmax(8.5rem,1fr)";

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      role="table"
      aria-label="Register"
    >
      {/* Header, outside the scroll area so it stays put. */}
      <div
        role="row"
        className={cn(
          "grid shrink-0 items-center border-b bg-muted/40 px-3 text-xs font-medium text-muted-foreground",
          compact ? "gap-2" : "gap-3",
        )}
        style={{ gridTemplateColumns: gridTemplate, height: 36 }}
      >
        <span role="columnheader">Name</span>
        <span role="columnheader">ID</span>
        <span role="columnheader">Group</span>
        {showTutor && <span role="columnheader">Tutor</span>}
        <span role="columnheader" className="text-center">
          First in
        </span>
        <span role="columnheader" className="text-center">
          Last out
        </span>
        <span role="columnheader">Status</span>
      </div>

      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto outline-none"
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
                className={cn(
                  "absolute left-0 grid w-full cursor-pointer items-center border-b px-3 text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60",
                  compact ? "gap-2" : "gap-3",
                  selected && "bg-accent hover:bg-accent",
                  changed && "animate-row-flash",
                )}
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                  gridTemplateColumns: gridTemplate,
                }}
              >
                <span role="cell" className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={row.fullName} src={null} />
                  <span className="truncate font-medium">{row.fullName}</span>
                  {row.hasManualEdit && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          aria-label="Corrected by hand"
                          className="inline-flex shrink-0 text-primary/70"
                        >
                          <PencilLineIcon className="size-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Corrected by hand</TooltipContent>
                    </Tooltip>
                  )}
                </span>
                <span
                  role="cell"
                  className="tabular truncate text-muted-foreground"
                >
                  {row.enrollNo}
                </span>
                <span
                  role="cell"
                  className="flex min-w-0 items-center gap-1.5 text-muted-foreground"
                >
                  <span className="truncate">{row.groupName ?? "—"}</span>
                  {row.category && <CategoryTag category={row.category} />}
                </span>
                {showTutor && (
                  <span role="cell" className="truncate text-muted-foreground">
                    {row.tutorInitials ?? "—"}
                  </span>
                )}
                {/* Centred: "HH:MM" is always the same width, so the times
                    still line up, and on a wide screen the column's room
                    falls on both sides rather than pushing the time up
                    against the status. */}
                <span
                  role="cell"
                  className={cn(
                    "tabular text-center",
                    !row.firstIn && "text-muted-foreground/60",
                  )}
                >
                  {formatTime(row.firstIn)}
                </span>
                <span
                  role="cell"
                  className={cn(
                    "tabular text-center",
                    !row.lastOut && "text-muted-foreground/60",
                  )}
                >
                  {row.lastOut ? formatTime(row.lastOut) : NO_TIME}
                </span>
                <span role="cell">
                  <StatusBadge
                    status={row.status}
                    isLate={row.isLate}
                    leftEarly={row.leftEarly}
                  />
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
    <div className="space-y-2 p-2">
      {rows.map((row) => (
        <button
          key={row.personId}
          type="button"
          onClick={() => onSelect(row.personId)}
          className={cn(
            "w-full rounded-lg border bg-card p-3 text-left shadow-xs transition-colors hover:bg-muted/40",
            recentlyChanged.has(row.personId) && "animate-row-flash",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name={row.fullName} />
              <div className="min-w-0">
                <p className="truncate font-medium">{row.fullName}</p>
                <p className="tabular text-xs text-muted-foreground">
                  {row.enrollNo} · {row.groupName ?? "No group"}
                  {row.category && ` · ${row.category}`}
                </p>
              </div>
            </div>
            <StatusBadge
              status={row.status}
              isLate={row.isLate}
              leftEarly={row.leftEarly}
              size="sm"
            />
          </div>
          <div className="tabular mt-2 flex gap-4 text-xs text-muted-foreground">
            <span>In {formatTime(row.firstIn)}</span>
            <span>Out {row.lastOut ? formatTime(row.lastOut) : NO_TIME}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
