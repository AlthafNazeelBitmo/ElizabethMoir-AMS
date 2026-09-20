import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import {
  requireRole,
  requireSession,
  unauthorized,
  type CookieContext,
} from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { Db } from "../db/client.js";
import {
  BRANCHES,
  DAY_STATUSES,
  dayRecords,
  manualAdjustments,
  people,
  users,
} from "../db/schema/index.js";
import type { RegisterBroadcaster } from "./broadcaster.js";
import type { RegisterService } from "./service.js";

export interface RegisterRoutesOptions {
  db: Db;
  auth: AuthService;
  cookies: CookieContext;
  register: RegisterService;
  broadcaster: RegisterBroadcaster;
  /**
   * What a reconnecting client may rely on. `buffer`: events it missed are
   * replayed from this process's buffer. `none`: the process may have been
   * replaced since it was last connected, so it should refetch on every
   * reconnect. A serverless host is the second kind.
   */
  streamContinuity?: "buffer" | "none";
}

const MAX_LIMIT = 200;

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

const liveQuery = z.object({
  date: dateString,
  branch: z.enum(BRANCHES).optional(),
  group: z.coerce.number().int().optional(),
  tutor: z.coerce.number().int().optional(),
  status: z.enum(DAY_STATUSES).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(MAX_LIMIT),
  cursor: z.string().max(500).optional(),
});

const summaryQuery = z.object({
  date: dateString,
  branch: z.enum(BRANCHES).optional(),
  group: z.coerce.number().int().optional(),
  tutor: z.coerce.number().int().optional(),
  q: z.string().trim().max(200).optional(),
});

const scansQuery = z.object({ from: dateString, to: dateString });

const adjustBody = z.object({
  firstIn: z.string().datetime().nullable().optional(),
  lastOut: z.string().datetime().nullable().optional(),
  status: z.enum(DAY_STATUSES).optional(),
  // The specification requires a reason for every manual change, and a
  // reason nobody can read is not a reason.
  reason: z.string().trim().min(3).max(500),
});

/** How often a heartbeat goes out, so a dead connection is noticed. */
const HEARTBEAT_MS = 20_000;

export const registerRoutes: FastifyPluginAsync<RegisterRoutesOptions> = async (
  app,
  { db, auth, cookies, register, broadcaster, streamContinuity = "buffer" },
) => {
  const guard = requireSession({ auth, cookies });
  const preHandler = [guard];

  app.get("/api/register/live", { preHandler }, async (req, reply) => {
    const parsed = liveQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_query",
        message: "Check the date and filters.",
        problems: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      });
    }
    const { date, branch, group, tutor, status, q, limit, cursor } =
      parsed.data;
    const page = await register.live(
      req.auth!.role,
      { date, branch, groupId: group, tutorId: tutor, status, q },
      limit,
      cursor ?? null,
    );
    return reply.send(page);
  });

  app.get("/api/register/summary", { preHandler }, async (req, reply) => {
    const parsed = summaryQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({
          error: "invalid_query",
          message: "Check the date and filters.",
        });
    }
    const { date, branch, group, tutor, q } = parsed.data;
    const [counts, groupCounts] = await Promise.all([
      register.summary(req.auth!.role, {
        date,
        branch,
        groupId: group,
        tutorId: tutor,
        q,
      }),
      register.groupCounts(req.auth!.role, date),
    ]);
    return reply.send({ counts, groups: groupCounts });
  });

  // ── The live stream ─────────────────────────────────────────────────────

  app.get("/api/register/stream", { preHandler }, async (req, reply) => {
    const session = req.auth;
    if (!session) return unauthorized(reply);

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Without this an nginx or Caddy buffer can hold events until the
      // response ends, which for a stream is never.
      "x-accel-buffering": "no",
    });

    const send = (id: number | null, eventName: string, data: unknown) => {
      if (reply.raw.writableEnded) return;
      const lines = [
        id === null ? null : `id: ${id}`,
        `event: ${eventName}`,
        `data: ${JSON.stringify(data)}`,
        "",
        "",
      ].filter((l) => l !== null);
      reply.raw.write(lines.join("\n"));
    };

    // Replay anything missed while the connection was down. A gap too large
    // to fill is answered honestly, so the client refetches rather than
    // rendering a screen with holes in it.
    const lastEventHeader = req.headers["last-event-id"];
    const lastEventId = Number(
      Array.isArray(lastEventHeader)
        ? lastEventHeader[0]
        : (lastEventHeader ?? ""),
    );
    if (Number.isInteger(lastEventId) && lastEventId > 0) {
      const missed = broadcaster.replay(lastEventId, session.role);
      if (missed === null) {
        send(null, "resync", { reason: "too_far_behind" });
      } else {
        for (const published of missed)
          send(published.id, published.event.type, published.event);
      }
    }

    send(null, "hello", {
      lastEventId: broadcaster.lastEventId,
      role: session.role,
      instance: broadcaster.instanceId,
      continuity: streamContinuity,
    });

    const unsubscribe = broadcaster.subscribe(session.role, (published) => {
      send(published.id, published.event.type, published.event);
    });

    const heartbeat = setInterval(() => {
      send(null, "heartbeat", { at: new Date().toISOString() });
    }, HEARTBEAT_MS);

    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.raw.on("close", close);
    req.raw.on("error", close);

    // Hand the socket to the stream: Fastify must not try to end it.
    return reply;
  });

  // ── Person detail ───────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    "/api/people/:id",
    { preHandler },
    async (req, reply) => {
      const person = await register.person(req.auth!.role, req.params.id);
      // A person this role may not see is reported as absent from the system
      // rather than forbidden: a 403 would confirm they exist.
      if (!person)
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such person." });
      return reply.send({ person });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/people/:id/scans",
    { preHandler },
    async (req, reply) => {
      const parsed = scansQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_query", message: "Give from and to dates." });
      }
      const [scanRows, dayRows] = await Promise.all([
        register.personScans(
          req.auth!.role,
          req.params.id,
          parsed.data.from,
          parsed.data.to,
        ),
        register.personDays(
          req.auth!.role,
          req.params.id,
          parsed.data.from,
          parsed.data.to,
        ),
      ]);
      if (scanRows === null || dayRows === null) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such person." });
      }
      return reply.send({ scans: scanRows, days: dayRows });
    },
  );

  // ── Manual adjustment ───────────────────────────────────────────────────

  // Correcting a day is an administrator's act: it overrides what the
  // readers said and stands in every report afterwards.
  app.patch<{ Params: { id: string } }>(
    "/api/day-records/:id",
    { preHandler: [...preHandler, requireRole("full")] },
    async (req, reply) => {
      const parsed = adjustBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_request",
          message:
            "A reason of at least three characters is required for any change.",
          problems: parsed.error.issues.map(
            (i) => `${i.path.join(".")}: ${i.message}`,
          ),
        });
      }

      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "Bad record id." });
      }

      // Read through the person so the role's branch filter applies: a
      // student-only account must not be able to edit a staff day by id.
      const [existing] = await db
        .select({ record: dayRecords, personId: people.id })
        .from(dayRecords)
        .innerJoin(people, eq(people.id, dayRecords.personId))
        .where(eq(dayRecords.id, id))
        .limit(1);
      if (!existing) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such day record." });
      }
      const visible = await register.person(req.auth!.role, existing.personId);
      if (!visible) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such day record." });
      }

      const before = existing.record;
      const patch: Record<string, unknown> = { hasManualEdit: true };
      const changed: Array<{
        field: string;
        before: string | null;
        after: string | null;
      }> = [];

      if (parsed.data.firstIn !== undefined) {
        patch["firstIn"] =
          parsed.data.firstIn === null ? null : new Date(parsed.data.firstIn);
        changed.push({
          field: "first_in",
          before: before.firstIn?.toISOString() ?? null,
          after: parsed.data.firstIn,
        });
      }
      if (parsed.data.lastOut !== undefined) {
        patch["lastOut"] =
          parsed.data.lastOut === null ? null : new Date(parsed.data.lastOut);
        changed.push({
          field: "last_out",
          before: before.lastOut?.toISOString() ?? null,
          after: parsed.data.lastOut,
        });
      }
      if (parsed.data.status !== undefined) {
        patch["status"] = parsed.data.status;
        changed.push({
          field: "status",
          before: before.status,
          after: parsed.data.status,
        });
      }

      if (changed.length === 0) {
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "Nothing to change." });
      }

      const [after] = await db
        .update(dayRecords)
        .set(patch)
        .where(eq(dayRecords.id, id))
        .returning();

      for (const change of changed) {
        await db.insert(manualAdjustments).values({
          dayRecordId: id,
          userId: req.auth!.userId,
          field: change.field,
          oldValue: change.before,
          newValue: change.after,
          reason: parsed.data.reason,
        });
      }

      await writeAudit(db, req.log, {
        action: "manual_adjustment",
        userId: req.auth!.userId,
        entity: "day_record",
        entityId: String(id),
        before,
        after: { ...after, reason: parsed.data.reason },
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return reply.send({ dayRecord: after, reason: parsed.data.reason });
    },
  );

  /** Who last corrected this day, for the panel to show. */
  app.get<{ Params: { id: string } }>(
    "/api/day-records/:id/adjustments",
    { preHandler },
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "Bad record id." });
      }
      const [record] = await db
        .select({ personId: dayRecords.personId })
        .from(dayRecords)
        .where(eq(dayRecords.id, id))
        .limit(1);
      if (
        !record ||
        !(await register.person(req.auth!.role, record.personId))
      ) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such day record." });
      }
      const rows = await db
        .select({
          id: manualAdjustments.id,
          field: manualAdjustments.field,
          oldValue: manualAdjustments.oldValue,
          newValue: manualAdjustments.newValue,
          reason: manualAdjustments.reason,
          createdAt: manualAdjustments.createdAt,
          byName: users.fullName,
        })
        .from(manualAdjustments)
        .leftJoin(users, eq(users.id, manualAdjustments.userId))
        .where(eq(manualAdjustments.dayRecordId, id))
        .orderBy(manualAdjustments.createdAt);
      return reply.send({ adjustments: rows });
    },
  );
};
