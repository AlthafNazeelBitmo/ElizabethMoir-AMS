import type { FastifyServerOptions } from "fastify";
import type { Config } from "./config.js";

/**
 * Logging policy (spec §9): no student names, enrollment numbers, or IP
 * addresses in application logs. Fastify's default request serializer emits
 * `remoteAddress`, so we replace it with one that does not.
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
