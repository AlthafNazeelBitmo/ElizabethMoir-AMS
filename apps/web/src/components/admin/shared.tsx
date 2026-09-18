import { AlertCircleIcon, CheckIcon, CopyIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Table as UiTable,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.js";
import { ApiError } from "@/lib/api.js";
import { cn } from "@/lib/utils.js";

export { formatDateTime } from "@/lib/format.js";

/** Chrome shared by the admin sections, so each one reads the same way. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 lg:p-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}

/** A bordered surface for a table or a form. */
export function Panel({
  children,
  className,
  title,
  description,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: string | undefined;
  description?: string | undefined;
  actions?: ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border bg-card shadow-xs", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

/** A table inside a Panel: header cells are passed as children of `head`. */
export function Table({
  head,
  children,
}: {
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <UiTable>
        <TableHeader>
          <TableRow className="hover:bg-transparent">{head}</TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </UiTable>
    </div>
  );
}

export { TableHead as Th, TableRow as Tr };
export { TableCell as Td } from "@/components/ui/table.js";

/**
 * An error the operator can act on. The API's message is shown verbatim
 * because it was written to be read — "This is the only administrator
 * account" is more useful than anything this component could invent.
 */
export function Problem({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError
      ? error.message
      : "The server could not be reached.";
  const problems = error instanceof ApiError ? error.problems : [];
  return (
    <div
      role="alert"
      className="flex gap-2.5 rounded-lg border border-status-absent/30 bg-status-absent-bg px-3 py-2.5 text-sm text-status-absent"
    >
      <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
      <div>
        <p>{message}</p>
        {problems.length > 0 && (
          <ul className="mt-1 list-inside list-disc">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A note under a section: what the control does, and when not to use it. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="max-w-2xl text-xs text-muted-foreground">{children}</p>;
}

/**
 * A generated password, shown once.
 *
 * Deliberately loud: it cannot be recovered, and an administrator who
 * closes the panel without copying it has to reset again.
 */
export function OneTimePassword({
  password,
  onDone,
}: {
  password: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      // No clipboard access; the text is still selectable below.
    }
  };
  return (
    <div className="rounded-lg border border-primary/30 bg-accent/50 p-4">
      <p className="text-sm font-medium text-accent-foreground">
        Temporary password
      </p>
      <div className="my-2 flex items-center gap-2">
        <p className="tabular flex-1 rounded-md border bg-card px-3 py-2 font-mono text-base select-all">
          {password}
        </p>
        {/* Copied by button, not by selection: a trailing space or line
            break picked up with the mouse is a wrong password, and five of
            those lock the account. */}
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Shown once; it cannot be recovered. Give it to the account holder over
        a channel you trust. They sign in with it, are asked to choose their
        own password, and from then on the temporary one no longer works.
      </p>
      <Button variant="ghost" size="sm" className="mt-3" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
