import { AlertCircleIcon, InboxIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button.js";
import { Skeleton } from "@/components/ui/misc.js";
import { cn } from "@/lib/utils.js";

/*
 * The states every screen has to have: nothing here yet, something failed,
 * still loading. Each says what to do next; none says "no data" or
 * "something went wrong".
 */

export function EmptyState({
  title,
  detail,
  icon: Icon = InboxIcon,
  action,
  className,
}: {
  title: string;
  detail?: string | undefined;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-48 flex-col items-center justify-center gap-3 p-8 text-center",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div className="max-w-sm">
        <p className="text-sm font-medium">{title}</p>
        {detail && (
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  detail,
  onRetry,
  className,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex h-full min-h-48 flex-col items-center justify-center gap-3 p-8 text-center",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-status-absent-bg text-status-absent">
        <AlertCircleIcon className="size-5" />
      </div>
      <div className="max-w-md">
        <p className="text-sm font-semibold">{title}</p>
        {detail && (
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** A skeleton shaped like the thing it stands in for, never a spinner. */
export function TableSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <div className="p-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b px-3 py-2.5">
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="ml-auto h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card p-4", className)} aria-hidden>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-3 h-2 w-full" />
    </div>
  );
}

/** The title row of a page: what it is, and the controls that act on it. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
