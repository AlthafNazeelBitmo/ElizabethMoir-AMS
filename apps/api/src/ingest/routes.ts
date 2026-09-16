import type { IncomingMessage } from "node:http";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { bodyToText, parseBody, type Envelope } from "./envelope.js";
import type { RawEventStore } from "./store.js";

export interface IngestPluginOptions {
  config: Config;
  store: RawEventStore;
}

/**
 * Phase 0 discovery ingest.
 *
 * Contract with the upstream platform (spec §2): accept any content type,
 * read the raw body before parsing, never throw, never answer anything but
 * `200 OK` with an empty body. Everything that arrives is written down.
 *
 * This plugin is encapsulated on purpose: its catch-all content-type parser
 * and its "everything is 200" error handler must not leak to other routes.
 */
export const ingestRoutes: FastifyPluginAsync<IngestPluginOptions> = async (app, { config, store }) => {
  // Replace Fastify's JSON/text parsers: a malformed JSON body must reach us
  // as text, not as a 400 from the framework.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: config.INGEST_BODY_LIMIT_BYTES }, (_req, body, done) => {
    done(null, body);
  });

  // Anything the framework rejects before the handler runs is still a
  // delivery attempt worth recording. Two cases matter:
  //  - body over the cap: discard it, record the size and reason;
  //  - a Content-Type the framework cannot even parse (no slash, say):
  //    the stream is still unread, so read it ourselves.
  app.setErrorHandler(async (err: unknown, req, reply) => {
    const e = err instanceof Error ? (err as Error & { code?: string; statusCode?: number }) : undefined;
    const code = e?.code ?? e?.name ?? "UnknownError";
    const statusCode = e?.statusCode;
    req.log.warn({ code, statusCode }, "ingest request rejected by framework; recording");

    if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      const body = await readRawBody(req.raw, config.INGEST_BODY_LIMIT_BYTES);
      if (body !== null) {
        await store.save(buildEnvelope(req, body, null));
        return ok(reply);
      }
      await store.save(buildEnvelope(req, null, `body exceeded ${config.INGEST_BODY_LIMIT_BYTES} byte cap; discarded`));
      return ok(reply);
    }

    const reason =
      code === "FST_ERR_CTP_BODY_TOO_LARGE"
        ? `body exceeded ${config.INGEST_BODY_LIMIT_BYTES} byte cap; discarded`
        : `request rejected before handling: ${code}${statusCode ? ` (${statusCode})` : ""}`;
    await store.save(buildEnvelope(req, null, reason));
    return ok(reply);
  });

  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const raw = req.body;
      const buf = Buffer.isBuffer(raw) ? raw : raw == null ? Buffer.alloc(0) : Buffer.from(String(raw));
      const outcome = await store.save(buildEnvelope(req, buf, null));
      req.log.info({ outcome, bodyBytes: buf.length }, "ingest received");
    } catch (err) {
      // Belt and braces: buildEnvelope and store.save are written not to
      // throw, but the upstream must never see a non-200 regardless.
      req.log.error({ err }, "ingest handler threw; swallowed");
    }
    return ok(reply);
  };

  const routePath = config.INGEST_PATH_TOKEN ? `/ingest/${config.INGEST_PATH_TOKEN}/raw` : "/ingest/raw";
  // POST is what the vendor's reference expects, but accept every method so a
  // misconfigured platform still leaves evidence in raw_events.
  app.route({ method: ["POST", "PUT", "GET", "DELETE", "PATCH", "OPTIONS"], url: routePath, handler });
};

function ok(reply: FastifyReply) {
  return reply.code(200).header("content-length", "0").send();
}

/** Reads an as-yet-unconsumed request stream up to `limit` bytes; null if it exceeds. */
function readRawBody(raw: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (value: Buffer | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    raw.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        raw.removeAllListeners("data");
        raw.resume();
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    raw.on("end", () => finish(Buffer.concat(chunks)));
    raw.on("error", () => finish(Buffer.concat(chunks)));
    if (raw.readableEnded) finish(Buffer.concat(chunks));
  });
}

function buildEnvelope(req: FastifyRequest, body: Buffer | null, parseErrorOverride: string | null): Envelope {
  const contentType = headerString(req.headers["content-type"]);
  const base = {
    receivedAt: new Date().toISOString(),
    remoteIp: req.ip || null,
    method: req.method,
    headers: { ...req.headers },
    contentType,
  };

  if (body === null) {
    const declared = Number(headerString(req.headers["content-length"]));
    return {
      ...base,
      bodyBytes: Number.isFinite(declared) ? declared : null,
      bodyText: null,
      bodyJson: null,
      batchSize: null,
      parseError: parseErrorOverride ?? "body not captured",
    };
  }

  const { text, wasBinary } = bodyToText(body);
  const parsed = wasBinary
    ? { bodyJson: null, batchSize: null, parseError: "body is not valid UTF-8" }
    : parseBody(text);
  return { ...base, bodyBytes: body.length, bodyText: text, ...parsed };
}

function headerString(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  return Array.isArray(v) ? v.join(", ") : v;
}
