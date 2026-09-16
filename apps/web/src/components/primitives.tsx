import type { ReactNode } from "react";
import type { DayStatus } from "../lib/api.js";
import { STATUS_PRESENTATION } from "../lib/format.js";

/**
 * The small shared pieces. No component kit — these are the four or five
 * things this application actually needs, kept plain.
 */

export function Button({
  children,
  variant = "secondary",
  type = "button",
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: "bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-300",
    secondary:
      "bg-white text-neutral-700 border border-neutral-300 hover:bg-neutral-50 disabled:text-neutral-400",
    ghost: "text-neutral-600 hover:bg-neutral-100 disabled:text-neutral-400",
    danger:
      "bg-status-absent text-white hover:brightness-95 disabled:opacity-50",
  }[variant];
  return (
    <button
      type={type}
      {...props}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

/**
 * A status badge. The shape is redundant with the colour on purpose: this
 * has to be readable by someone with deuteranopia and at a glance from a
 * few metres away.
 */
export function StatusBadge({
  status,
  isLate,
}: {
  status: DayStatus;
  isLate?: boolean;
}) {
  const presentation = STATUS_PRESENTATION[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${presentation.className}`}
      >
        <StatusShape status={status} />
        {presentation.label}
      </span>
      {isLate && status !== "late" && (
        <span className="rounded-full border border-amber-300 bg-status-lateBg px-1.5 py-0.5 text-xs font-medium text-status-late">
          Late
        </span>
      )}
    </span>
  );
}

function StatusShape({ status }: { status: DayStatus }) {
  const presentation = STATUS_PRESENTATION[status];
  const base = "inline-block h-2 w-2 shrink-0";
  switch (presentation.shape) {
    case "filled":
      return (
        <span
          aria-hidden
          className={`${base} rounded-full ${presentation.dotClassName}`}
        />
      );
    case "half":
      return (
        <span
          aria-hidden
          className={`${base} rounded-full ${presentation.dotClassName}`}
          style={{ clipPath: "inset(0 0 0 50%)" }}
        />
      );
    case "hollow":
      return (
        <span
          aria-hidden
          className={`${base} rounded-full border-2 border-status-late bg-transparent`}
        />
      );
    case "cross":
      return (
        <span aria-hidden className={`${base} relative`}>
          <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rotate-45 bg-status-absent" />
          <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 -rotate-45 bg-status-absent" />
        </span>
      );
    case "outline":
      return (
        <span
          aria-hidden
          className={`${base} rounded-full ${presentation.dotClassName}`}
        />
      );
  }
}

/**
 * An error the user can act on. Says what failed and what to do; never
 * apologises and never says "something went wrong".
 */
export function ErrorState({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="max-w-md">
        <p className="text-sm font-semibold text-neutral-800">{title}</p>
        {detail && <p className="mt-1 text-sm text-neutral-600">{detail}</p>}
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** An empty state that says what to do next, never "No data". */
export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      {detail && <p className="max-w-sm text-sm text-neutral-500">{detail}</p>}
    </div>
  );
}

/** A skeleton shaped like the thing it stands in for, never a spinner. */
export function TableSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <div className="animate-pulse p-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-neutral-100 px-3 py-2.5"
        >
          <div className="h-3 w-48 rounded bg-neutral-200" />
          <div className="h-3 w-16 rounded bg-neutral-100" />
          <div className="h-3 w-20 rounded bg-neutral-100" />
          <div className="ml-auto h-3 w-24 rounded bg-neutral-100" />
        </div>
      ))}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      {children}
      {hint && <span className="text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-brand-500";
