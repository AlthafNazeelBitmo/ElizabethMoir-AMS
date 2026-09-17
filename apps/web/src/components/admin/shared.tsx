import type { ReactNode } from "react";
import { ApiError } from "../../lib/api.js";

/** Chrome shared by the admin sections, so each one reads the same way. */
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-sm font-semibold text-brand-700">{title}</h1>
          {description && (
            <p className="mt-0.5 max-w-2xl text-sm text-neutral-500">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Table({
  head,
  children,
}: {
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-600">
          {head}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

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
      className="my-2 rounded border border-rose-200 bg-status-absentBg p-2 text-sm"
    >
      <p className="text-status-absent">{message}</p>
      {problems.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-status-absent">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
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
  return (
    <div className="my-3 rounded border border-brand-200 bg-brand-50 p-3">
      <p className="text-sm font-medium text-brand-700">Temporary password</p>
      <p className="tabular my-2 select-all font-mono text-base text-neutral-900">
        {password}
      </p>
      <p className="text-xs text-neutral-600">
        This is shown once and cannot be recovered. Give it to the account
        holder over a channel you trust — they must change it when they first
        sign in.
      </p>
      <button
        onClick={onDone}
        className="mt-2 rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium"
      >
        I have copied it
      </button>
    </div>
  );
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Colombo",
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}
