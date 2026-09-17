import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { ScanProcessor } from "./processor.js";

export interface ProcessingPluginOptions {
  config: Config;
  processor: ScanProcessor;
}

/**
 * The scheduled drain.
 *
 * On a long-running deployment an interval does this and the endpoint is a
 * manual override. On a serverless host there is no process to hold an
 * interval, so a platform scheduler calls it — Vercel Cron issues a GET with
 * `Authorization: Bearer $CRON_SECRET`, which is why GET is accepted.
 *
 * Nothing here is user-facing, and an unauthenticated caller gets a 404
 * rather than a 401: the endpoint's existence is not worth confirming.
 */
export const processingRoutes: FastifyPluginAsync<ProcessingPluginOptions> = async (
  app,
  { config, processor },
) => {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!authorised(req, config)) {
      req.log.warn("process endpoint token rejected");
      return reply.code(404).send();
    }
    const started = Date.now();
    const result = await processor.processPending();
    // The nightly absence job, on the same schedule. It is idempotent and
    // does nothing before the day has reached the point where absence is
    // meaningful, so running it often is free — and running it only at
    // midnight would leave the register wrong all day.
    const absencesMarked = await processor.markAbsencesForToday();
    req.log.info(
      { ...result, absencesMarked, ms: Date.now() - started },
      "processed pending envelopes",
    );
    return reply.code(200).send({ ...result, absencesMarked, ms: Date.now() - started });
  };

  app.route({ method: ["GET", "POST"], url: "/internal/process", handler });
};

function authorised(req: FastifyRequest, config: Config): boolean {
  // The cron secret when the platform sets one, otherwise the report token,
  // so a deployment needs no extra configuration to be able to process.
  const expected = config.CRON_SECRET ?? config.REPORT_TOKEN;
  const auth = req.headers.authorization;
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const query = (req.query as Record<string, unknown>)["token"];
  const candidate = bearer ?? (typeof query === "string" ? query : null);
  if (candidate === null) return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
