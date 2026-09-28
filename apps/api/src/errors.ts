/**
 * Describing an error for the log.
 *
 * A database failure arrives wrapped: Drizzle raises "Failed query: select
 * …" and keeps the driver's own error — the one that says *why* — in
 * `cause`. Logging the wrapper alone tells you which query failed and
 * nothing about whether the database refused the password, ran out of
 * connections, or was never reached. That is the difference between
 * knowing what to do and guessing, at the moment when the school's
 * register is down.
 *
 * So the chain is walked to its end, and the fields Postgres sets on the
 * way (`code`, `severity`, `routine`) are carried out with it.
 *
 * What is deliberately *not* carried out is the parameter list. Drizzle
 * appends the values it bound — which on this system means names and
 * enrolment numbers — and §9 keeps those out of application logs. The
 * query stays, the values go.
 */
export interface ErrorSummary {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  severity?: string;
  routine?: string;
  /** The innermost message, when the error that was thrown wrapped one. */
  cause?: string;
}

const MAX_CAUSE_DEPTH = 5;

export function describeError(err: unknown): ErrorSummary {
  if (!(err instanceof Error)) {
    return { name: "UnknownError", message: String(err) };
  }

  let innermost: Error = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    const cause = (innermost as { cause?: unknown }).cause;
    if (!(cause instanceof Error)) break;
    innermost = cause;
  }

  const field = (source: Error, key: string): string | undefined => {
    const value = (source as unknown as Record<string, unknown>)[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const code = field(innermost, "code") ?? field(err, "code");
  const severity =
    field(innermost, "severity_local") ?? field(innermost, "severity");
  const routine = field(innermost, "routine");

  return {
    name: err.name,
    // The wrapper's message names the query, which is worth keeping; the
    // innermost one says why it failed.
    message: withoutParameters(err.message),
    ...(err.stack ? { stack: err.stack } : {}),
    ...(code ? { code } : {}),
    ...(severity ? { severity } : {}),
    ...(routine ? { routine } : {}),
    ...(innermost !== err
      ? { cause: withoutParameters(innermost.message) }
      : {}),
  };
}

/**
 * Drops Drizzle's bound parameters, which carry the school's own data:
 * "Failed query: insert into scans …" keeps its query, and the values
 * bound to it are replaced by a note that they were there.
 */
function withoutParameters(message: string): string {
  const marker = "\nparams:";
  const at = message.indexOf(marker);
  if (at === -1) return message;
  return `${message.slice(0, at)}${marker} [omitted]`;
}
