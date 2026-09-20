import type { RegisterStatus } from "@/lib/api.js";
import { STATUS_PRESENTATION } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/**
 * A status chip. Colour plus a distinct shape plus the word: readable by
 * someone with deuteranopia, and at a glance from a few metres away.
 */
export function StatusBadge({
  status,
  isLate,
  size = "default",
}: {
  status: RegisterStatus;
  isLate?: boolean;
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
