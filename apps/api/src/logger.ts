import type { FastifyServerOptions } from "fastify";
import type { Config } from "./config.js";
import { describeError } from "./errors.js";

/**
 * Logging policy (spec §9): no student names, enrollment numbers, or IP
 * addresses in application logs. Fastify's default request serializer emits
 * `remoteAddress`, so we replace it with one that does not — and the error
 * serializer drops the parameters a failed query would otherwise carry.
 *
 * Errors are described rather than printed: a database failure keeps its
 * reason in `cause`, and a log that says only which query failed cannot
 * tell anybody what to do about it.
 */
export function loggerOptions(config: Config): NonNullable<FastifyServerOptions["logger"]> {
  const base = {
    level: config.LOG_LEVEL,
    serializers: {
      req(req: { id: unknown; method: string; url: string }) {
        return { id: req.id, method: req.method, url: redactUrl(req.url) };
      },
      res(res: { statusCode: number }) {
        return { statusCode: res.statusCode };
      },
      // Pino's own shape, filled from the description: the fields it
      // insists on, and the reason underneath.
      err(err: unknown) {
        const { name, message, stack, ...rest } = describeError(err);
        return { type: name, message, stack: stack ?? "", ...rest };
      },
    },
  };

  if (config.NODE_ENV === "development") {
    return {
      ...base,
      transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
    };
  }
  return base;
}

/** Strip any query string (it may carry the report token) and the ingest path token. */
function redactUrl(url: string): string {
  const path = url.split("?")[0] ?? url;
  return path.replace(/^\/ingest\/[^/]{16,}\//, "/ingest/[token]/");
}
