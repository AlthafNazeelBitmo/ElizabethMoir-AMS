import type { Branch, RegisterStatus } from "@/lib/api.js";
import { STATUS_PRESENTATION } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/**
 * A status chip. Colour plus a distinct shape plus the word: readable by
 * someone with deuteranopia, and at a glance from a few metres away.
 */
/**
 * The school's category for a member of staff — HOD, Teaching, Admin —
 * as a small tag beside their group. Quiet, because it is context rather
 * than status, and absent for students, who have none.
 */
export function CategoryTag({
  category,
  className,
}: {
  category: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm border border-border/70 bg-muted/60 px-1.5 py-px text-[0.6875rem] font-medium leading-4 text-muted-foreground print:border-black/30 print:bg-transparent",
        className,
      )}
    >
      {category}
    </span>
  );
}

/**
 * The flags sit beside the status as their own small tags: "Present ·
 * Late", "Departed · Left early" — facts about the day, not statuses of
 * their own.
 *
 * Each is shown wherever the school judges it. Lateness is decided by
 * the group's own hour for staff and the school's for a form, so a staff
 * group with no hour set never carries the tag; leaving early is decided
 * by the group's cut-off, which most groups do not set. Both decisions
 * are the server's, in the flags themselves.
 */
export function StatusBadge({
  status,
  isLate = false,
  leftEarly = false,
  size = "default",
}: {
  status: RegisterStatus;
  isLate?: boolean;
  leftEarly?: boolean;
  size?: "sm" | "default";
}) {
  const p = STATUS_PRESENTATION[status];
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
          size === "sm"
            ? "px-1.5 py-px text-[0.6875rem]"
            : "px-2 py-0.5 text-xs",
          p.text,
          p.bg,
          (status === "not_expected" || status === "pending") &&
            "border border-dashed border-status-idle",
        )}
      >
        <StatusShape status={status} />
        {p.label}
      </span>
      {isLate && status !== "late" && (
        <span
          className={cn(
            "rounded-full font-medium text-status-late bg-status-late-bg",
            size === "sm"
              ? "px-1.5 py-px text-[0.6875rem]"
              : "px-1.5 py-0.5 text-xs",
          )}
        >
          Late
        </span>
      )}
      {leftEarly && (
        <span
          className={cn(
            "rounded-full font-medium text-status-departed bg-status-departed-bg",
            size === "sm"
              ? "px-1.5 py-px text-[0.6875rem]"
              : "px-1.5 py-0.5 text-xs",
          )}
        >
          Left early
        </span>
      )}
    </span>
  );
}

export function StatusShape({
  status,
  className,
}: {
  status: RegisterStatus;
  className?: string;
}) {
  const p = STATUS_PRESENTATION[status];
  const base = cn("inline-block size-2 shrink-0", className);
  switch (p.shape) {
    case "filled":
      return <span aria-hidden className={cn(base, "rounded-full", p.solid)} />;
    case "half":
      return (
        <span
          aria-hidden
          className={cn(base, "rounded-full", p.solid)}
          style={{ clipPath: "inset(0 0 0 50%)" }}
        />
      );
    case "hollow":
      return (
        <span
          aria-hidden
          className={cn(base, "rounded-full border-2 border-status-late")}
        />
      );
    case "cross":
      return (
        <span aria-hidden className={cn(base, "relative")}>
          <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rotate-45 bg-status-absent" />
          <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 -rotate-45 bg-status-absent" />
        </span>
      );
    case "outline":
      return (
        <span
          aria-hidden
          className={cn(base, "rounded-full border border-status-idle")}
        />
      );
  }
}
