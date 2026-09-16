import { timingSafeEqual } from "node:crypto";
import { asc, gt } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { rawEvents } from "../db/schema.js";
import { analyze, type RawEventInput } from "./analyze.js";
import { renderReport } from "./render.js";

export interface DiscoveryPluginOptions {
  config: Config;
  db: Db;
}

/**
 * GET /ingest/report — the Phase 0 findings page.
 *
 * Protected by the static REPORT_TOKEN, accepted as `Authorization: Bearer`
 * or, for opening in a browser, `?token=`. A wrong or missing token gets a
 * 404 so the page's existence is not confirmed to anyone probing.
 */
export const discoveryRoutes: FastifyPluginAsync<DiscoveryPluginOptions> = async (app, { config, db }) => {
  app.get("/ingest/report", async (req, reply) => {
    if (!presentsToken(req, config.REPORT_TOKEN)) {
      req.log.warn("report token rejected");
      return reply.code(404).send();
    }
    const rows = await loadAllRawEvents(db);
    const html = renderReport(analyze(rows), new Date());
    return reply
      .code(200)
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer")
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'")
      .send(html);
  });

  app.get("/ingest/report.json", async (req, reply) => {
    if (!presentsToken(req, config.REPORT_TOKEN)) {
      return reply.code(404).send();
    }
    const rows = await loadAllRawEvents(db);
    return reply.code(200).header("cache-control", "no-store").send(analyze(rows));
  });
};

function presentsToken(req: FastifyRequest, expected: string): boolean {
  const auth = req.headers.authorization;
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const query = (req.query as Record<string, unknown>)["token"];
  const candidate = bearer ?? (typeof query === "string" ? query : null);
  if (candidate === null) return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Pages through raw_events by id so a long discovery run does not need one giant result set. */
async function loadAllRawEvents(db: Db): Promise<RawEventInput[]> {
  const out: RawEventInput[] = [];
  let cursor = 0;
  const pageSize = 1000;
  for (;;) {
    const page = await db
      .select({
        id: rawEvents.id,
        receivedAt: rawEvents.receivedAt,
        remoteIp: rawEvents.remoteIp,
        method: rawEvents.method,
        headers: rawEvents.headers,
        contentType: rawEvents.contentType,
        bodyBytes: rawEvents.bodyBytes,
        bodyJson: rawEvents.bodyJson,
        batchSize: rawEvents.batchSize,
        parseError: rawEvents.parseError,
      })
      .from(rawEvents)
      .where(gt(rawEvents.id, cursor))
      .orderBy(asc(rawEvents.id))
      .limit(pageSize);
    for (const row of page) out.push({ ...row, headers: row.headers ?? null });
    if (page.length < pageSize) break;
    cursor = page[page.length - 1]!.id;
  }
  return out;
}
