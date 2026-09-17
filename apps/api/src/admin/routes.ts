import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import "@fastify/multipart";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import {
  requireRole,
  requireSession,
  unauthorized,
  type CookieContext,
} from "../auth/http.js";
import { branchFilter } from "../auth/scope.js";
import type { AuthService } from "../auth/service.js";
import type { Db } from "../db/client.js";
import {
  BRANCHES,
  DEVICE_DIRECTIONS,
  devices,
  groups,
  people,
  scans,
  tutors,
  unknownEnrollments,
} from "../db/schema/index.js";
import { DirectoryImporter } from "../directory/import.js";
import type { ImportPlan } from "../directory/plan.js";
import type { ScanProcessor } from "../processing/processor.js";

export interface AdminRoutesOptions {
  db: Db;
  auth: AuthService;
  cookies: CookieContext;
  importer: DirectoryImporter;
  processor: ScanProcessor;
  /** Cap on an uploaded directory file. A school is thousands of rows, not millions. */
  maxUploadBytes: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

const peopleQuery = pagination.extend({
  q: z.string().trim().max(200).optional(),
  branch: z.enum(BRANCHES).optional(),
  groupId: z.coerce.number().int().optional(),
  includeInactive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default(false),
});

const createPerson = z.object({
  enrollNo: z.string().trim().min(1).max(64),
  fullName: z.string().trim().min(1).max(200),
  groupId: z.number().int().nullable().optional(),
  tutorId: z.number().int().nullable().optional(),
  admissionNo: z.string().trim().max(64).nullable().optional(),
});

const patchPerson = createPerson.partial().extend({
  isActive: z.boolean().optional(),
});

const patchDevice = z.object({
  label: z.string().trim().max(200).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  direction: z.enum(DEVICE_DIRECTIONS).optional(),
  trustCheckingStatus: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const upsertGroup = z.object({
  name: z.string().trim().min(1).max(100),
  branch: z.enum(BRANCHES),
  displayOrder: z.number().int().min(0),
  lateThreshold: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .nullable()
    .optional(),
  expectsAttendance: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const attachBody = z.object({
  personId: z.string().uuid().optional(),
  create: createPerson.omit({ enrollNo: true }).optional(),
});

/**
 * Administration: the directory, the groups, the readers, and the
 * enrolment numbers nobody has claimed yet.
 *
 * Every route here is `full` role only. A `student_only` account has no
 * admin section at all — but that is enforced here on the server, not by
 * the navigation the browser happens to render.
 */
export const adminRoutes: FastifyPluginAsync<AdminRoutesOptions> = async (
  app,
  { db, auth, cookies, importer, processor, maxUploadBytes },
) => {
  const guard = requireSession({ auth, cookies });
  const adminOnly = requireRole("full");
  const preHandler = [guard, adminOnly];

  // A directory file may arrive as multipart from a browser's file input, or
  // as a raw body from a script. Registering these here rather than globally
  // keeps them inside this plugin's scope.
  app.addContentTypeParser(
    ["text/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"],
    { parseAs: "string", bodyLimit: maxUploadBytes },
    (_req, body, done) => {
      done(null, body);
    },
  );

  // ── People ──────────────────────────────────────────────────────────────

  app.get("/api/admin/people", { preHandler }, async (req, reply) => {
    const parsed = peopleQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_query", message: "Check the filter values." });
    }
    const { page, limit, q, branch, groupId, includeInactive } = parsed.data;

    const conditions = [
      // Even on an admin endpoint the branch predicate is composed in, so
      // the rule holds if this route is ever opened to another role.
      branchFilter(req.auth!.role),
      includeInactive ? undefined : eq(people.isActive, true),
      branch ? eq(groups.branch, branch) : undefined,
      groupId ? eq(people.groupId, groupId) : undefined,
      q
        ? or(ilike(people.fullName, `%${q}%`), ilike(people.enrollNo, `%${q}%`))
        : undefined,
    ].filter(Boolean);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        id: people.id,
        enrollNo: people.enrollNo,
        fullName: people.fullName,
        admissionNo: people.admissionNo,
        isActive: people.isActive,
        groupId: people.groupId,
        groupName: groups.name,
        branch: groups.branch,
        tutorInitials: tutors.initials,
      })
      .from(people)
      .leftJoin(groups, eq(groups.id, people.groupId))
      .leftJoin(tutors, eq(tutors.id, people.tutorId))
      .where(where)
      .orderBy(asc(people.fullName))
      .limit(limit)
      .offset((page - 1) * limit);

    const [total] = await db
      .select({ n: count() })
      .from(people)
      .leftJoin(groups, eq(groups.id, people.groupId))
      .where(where);

    return reply.send({ people: rows, page, limit, total: total?.n ?? 0 });
  });

  app.post("/api/admin/people", { preHandler }, async (req, reply) => {
    const parsed = createPerson.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "Check the values.",
        problems: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      });
    }
    const existing = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.enrollNo, parsed.data.enrollNo))
      .limit(1);
    if (existing.length > 0) {
      return reply.code(409).send({
        error: "duplicate",
        message: `Enrolment number ${parsed.data.enrollNo} already belongs to someone.`,
      });
    }

    const [row] = await db.insert(people).values(parsed.data).returning();
    await writeAudit(db, req.log, {
      action: "person_created",
      userId: req.auth!.userId,
      entity: "person",
      entityId: row!.id,
      after: parsed.data,
      ip: req.ip || null,
      userAgent: req.headers["user-agent"] ?? null,
    });
    return reply.code(201).send({ person: row });
  });

  app.patch<{ Params: { id: string } }>(
    "/api/admin/people/:id",
    { preHandler },
    async (req, reply) => {
      const parsed = patchPerson.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "Check the values." });
      }
      const [before] = await db
        .select()
        .from(people)
        .where(eq(people.id, req.params.id))
        .limit(1);
      if (!before)
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such person." });

      const [after] = await db
        .update(people)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(people.id, req.params.id))
        .returning();

      await writeAudit(db, req.log, {
        action:
          parsed.data.isActive === false
            ? "person_deactivated"
            : "person_modified",
        userId: req.auth!.userId,
        entity: "person",
        entityId: req.params.id,
        before,
        after,
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });
      return reply.send({ person: after });
    },
  );

  // ── CSV import ──────────────────────────────────────────────────────────

  app.post("/api/admin/people/import", { preHandler }, async (req, reply) => {
    const text = await readUpload(req, maxUploadBytes);
    if (text === null) {
      return reply.code(400).send({
        error: "no_file",
        message:
          "Attach a CSV file with the columns enroll_no, full_name, branch, group.",
      });
    }
    if (text === TOO_LARGE) {
      return reply
        .code(413)
        .send({
          error: "too_large",
          message: `The file is larger than ${maxUploadBytes} bytes.`,
        });
    }

    const { plan, problems } = await importer.buildPlan(text);
    if (plan === null) {
      return reply.code(422).send({
        error: "invalid_file",
        message:
          "The file was not imported. Fix the problems listed and upload it again.",
        problems,
      });
    }
    return reply.send({ preview: summarise(plan), planHash: plan.hash });
  });

  app.post(
    "/api/admin/people/import/confirm",
    { preHandler },
    async (req, reply) => {
      const planHash = headerOrField(req, "x-plan-hash");
      const confirmDeactivations =
        headerOrField(req, "x-confirm-deactivations") === "true";
      const text = await readUpload(req, maxUploadBytes);

      if (text === null || text === TOO_LARGE || !planHash) {
        return reply.code(400).send({
          error: "invalid_request",
          message: "Attach the same file and the plan hash from the preview.",
        });
      }

      const outcome = await importer.apply(text, planHash, {
        confirmDeactivations,
        userId: req.auth!.userId,
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      if (outcome.ok) {
        return reply.send({ result: outcome.result });
      }
      if (outcome.reason === "invalid") {
        return reply.code(422).send({
          error: "invalid_file",
          message: "The file was not imported.",
          problems: outcome.problems,
        });
      }
      if (outcome.reason === "stale") {
        return reply.code(409).send({
          error: "plan_changed",
          message:
            "The directory changed since the preview, so nothing was imported. Review the new summary and confirm again.",
          preview: outcome.plan ? summarise(outcome.plan) : null,
          planHash: outcome.plan?.hash ?? null,
        });
      }
      return reply.code(409).send({
        error: "needs_deactivation_confirmation",
        message: `This import would deactivate ${outcome.plan.deactivates.length} people. Confirm that explicitly to proceed.`,
        preview: summarise(outcome.plan),
        planHash: outcome.plan.hash,
      });
    },
  );

  // ── Unknown enrolment numbers ───────────────────────────────────────────

  app.get(
    "/api/admin/unknown-enrollments",
    { preHandler },
    async (req, reply) => {
      const parsed = pagination.safeParse(req.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_query", message: "Check the page values." });
      }
      const { page, limit } = parsed.data;
      const rows = await db
        .select()
        .from(unknownEnrollments)
        .where(isNull(unknownEnrollments.resolvedPersonId))
        .orderBy(desc(unknownEnrollments.lastSeenAt))
        .limit(limit)
        .offset((page - 1) * limit);
      const [total] = await db
        .select({ n: count() })
        .from(unknownEnrollments)
        .where(isNull(unknownEnrollments.resolvedPersonId));
      return reply.send({
        unknownEnrollments: rows,
        page,
        limit,
        total: total?.n ?? 0,
      });
    },
  );

  app.post<{ Params: { enroll: string } }>(
    "/api/admin/unknown-enrollments/:enroll/attach",
    { preHandler },
    async (req, reply) => {
      const parsed = attachBody.safeParse(req.body);
      if (!parsed.success || (!parsed.data.personId && !parsed.data.create)) {
        return reply.code(400).send({
          error: "invalid_request",
          message:
            "Give either an existing personId or the details of a new person.",
        });
      }
      const enrollNo = req.params.enroll;

      const [unknown] = await db
        .select()
        .from(unknownEnrollments)
        .where(eq(unknownEnrollments.enrollNo, enrollNo))
        .limit(1);
      if (!unknown) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such unknown enrolment." });
      }

      let personId: string;
      if (parsed.data.personId) {
        const [person] = await db
          .select()
          .from(people)
          .where(eq(people.id, parsed.data.personId))
          .limit(1);
        if (!person) {
          return reply
            .code(404)
            .send({ error: "not_found", message: "No such person." });
        }
        if (person.enrollNo !== enrollNo) {
          // Repointing an existing person at this number: their old number
          // would stop matching, so this is refused rather than guessed at.
          return reply.code(409).send({
            error: "enroll_no_mismatch",
            message: `That person already has enrolment number ${person.enrollNo}. Create a new person instead, or correct theirs first.`,
          });
        }
        personId = person.id;
      } else {
        const [created] = await db
          .insert(people)
          .values({ enrollNo, ...parsed.data.create! })
          .returning({ id: people.id });
        personId = created!.id;
        await writeAudit(db, req.log, {
          action: "person_created",
          userId: req.auth!.userId,
          entity: "person",
          entityId: personId,
          after: { enrollNo, ...parsed.data.create },
          ip: req.ip || null,
          userAgent: req.headers["user-agent"] ?? null,
        });
      }

      // Claim the scans already recorded against this number, then redo the
      // days they fall in so the register reflects them immediately.
      await db
        .update(scans)
        .set({ personId })
        .where(and(eq(scans.enrollNo, enrollNo), isNull(scans.personId)));

      await db
        .update(unknownEnrollments)
        .set({ resolvedPersonId: personId })
        .where(eq(unknownEnrollments.enrollNo, enrollNo));

      const daysRecomputed = await processor.recomputeAllDaysFor(enrollNo);

      return reply.send({ personId, daysRecomputed });
    },
  );

  // ── Groups ──────────────────────────────────────────────────────────────

  app.get("/api/admin/groups", { preHandler }, async (_req, reply) => {
    // Active people in each group, so an edit is made knowing who it touches.
    const peopleCount = db
      .select({
        groupId: people.groupId,
        n: count().as("n"),
      })
      .from(people)
      .where(eq(people.isActive, true))
      .groupBy(people.groupId)
      .as("people_count");

    const rows = await db
      .select({
        id: groups.id,
        name: groups.name,
        branch: groups.branch,
        displayOrder: groups.displayOrder,
        lateThreshold: groups.lateThreshold,
        expectsAttendance: groups.expectsAttendance,
        isActive: groups.isActive,
        peopleCount: sql<number>`coalesce(${peopleCount.n}, 0)::int`,
      })
      .from(groups)
      .leftJoin(peopleCount, eq(peopleCount.groupId, groups.id))
      .orderBy(asc(groups.branch), asc(groups.displayOrder), asc(groups.name));
    return reply.send({ groups: rows });
  });

  async function groupNameTaken(
    name: string,
    exceptId: number | null,
  ): Promise<boolean> {
    const rows = await db
      .select({ id: groups.id })
      .from(groups)
      .where(ilike(groups.name, name))
      .limit(2);
    return rows.some((r) => r.id !== exceptId);
  }

  app.post("/api/admin/groups", { preHandler }, async (req, reply) => {
    const parsed = upsertGroup.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_request", message: "Check the values." });
    }
    // Case-insensitively: "Form 1" and "form 1" on the same rail would be
    // read as one group and filtered as two.
    if (await groupNameTaken(parsed.data.name, null)) {
      return reply.code(409).send({
        error: "conflict",
        message: `There is already a group called ${parsed.data.name}.`,
      });
    }
    const [row] = await db.insert(groups).values(parsed.data).returning();

    await writeAudit(db, req.log, {
      action: "group_created",
      userId: req.auth!.userId,
      entity: "group",
      entityId: String(row!.id),
      after: row,
      ip: req.ip || null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    return reply.code(201).send({ group: row });
  });

  app.patch<{ Params: { id: string } }>(
    "/api/admin/groups/:id",
    { preHandler },
    async (req, reply) => {
      const parsed = upsertGroup.partial().safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "Check the values." });
      }
      const id = Number(req.params.id);
      const [before] = await db
        .select()
        .from(groups)
        .where(eq(groups.id, id))
        .limit(1);
      if (!before)
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such group." });

      if (
        parsed.data.name !== undefined &&
        (await groupNameTaken(parsed.data.name, id))
      ) {
        return reply.code(409).send({
          error: "conflict",
          message: `There is already a group called ${parsed.data.name}.`,
        });
      }

      // Moving a group between branches moves everyone in it across the
      // line a student-only account must never see over. With people in
      // it, that is not a rename; it is a change to who may see whom, and
      // it is refused rather than audited.
      if (
        parsed.data.branch !== undefined &&
        parsed.data.branch !== before.branch
      ) {
        const [members] = await db
          .select({ n: count() })
          .from(people)
          .where(eq(people.groupId, id));
        if ((members?.n ?? 0) > 0) {
          return reply.code(422).send({
            error: "group_has_people",
            message:
              "This group has people in it, so its branch cannot be changed. Move them to another group first.",
          });
        }
      }

      const [after] = await db
        .update(groups)
        .set(parsed.data)
        .where(eq(groups.id, id))
        .returning();

      await writeAudit(db, req.log, {
        action: "group_modified",
        userId: req.auth!.userId,
        entity: "group",
        entityId: String(id),
        before,
        after,
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return reply.send({ group: after });
    },
  );

  // ── Devices ─────────────────────────────────────────────────────────────

  app.get("/api/admin/devices", { preHandler }, async (_req, reply) => {
    const rows = await db.select().from(devices).orderBy(asc(devices.serial));
    return reply.send({ devices: rows });
  });

  app.patch<{ Params: { id: string } }>(
    "/api/admin/devices/:id",
    { preHandler },
    async (req, reply) => {
      const parsed = patchDevice.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "Check the values." });
      }
      const [before] = await db
        .select()
        .from(devices)
        .where(eq(devices.id, Number(req.params.id)))
        .limit(1);
      if (!before)
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such device." });

      const [after] = await db
        .update(devices)
        .set(parsed.data)
        .where(eq(devices.id, Number(req.params.id)))
        .returning();

      // Changing a reader's direction changes how every scan through it is
      // interpreted, so it is audited like the consequential act it is.
      await writeAudit(db, req.log, {
        action: "device_configured",
        userId: req.auth!.userId,
        entity: "device",
        entityId: before.serial,
        before,
        after,
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });
      return reply.send({ device: after });
    },
  );

  app.get("/api/admin/tutors", { preHandler }, async (_req, reply) => {
    const rows = await db.select().from(tutors).orderBy(asc(tutors.initials));
    return reply.send({ tutors: rows });
  });
};

const TOO_LARGE = Symbol("too-large") as unknown as string;

/** Reads the uploaded CSV as text, whether multipart or a raw body. */
async function readUpload(
  req: FastifyRequest,
  maxBytes: number,
): Promise<string | null> {
  try {
    if (typeof req.isMultipart === "function" && req.isMultipart()) {
      const file = await req.file({ limits: { fileSize: maxBytes } });
      if (!file) return null;
      const buffer = await file.toBuffer();
      if (buffer.length > maxBytes) return TOO_LARGE;
      return buffer.toString("utf8");
    }
  } catch {
    return TOO_LARGE;
  }
  const body = req.body;
  if (typeof body === "string" && body.length > 0) {
    return Buffer.byteLength(body) > maxBytes ? TOO_LARGE : body;
  }
  if (Buffer.isBuffer(body)) {
    return body.length > maxBytes ? TOO_LARGE : body.toString("utf8");
  }
  return null;
}

function headerOrField(
  req: FastifyRequest,
  name: string,
): string | null {
  const header = req.headers[name];
  if (typeof header === "string") return header;
  if (Array.isArray(header)) return header[0] ?? null;
  return null;
}

/** The shape the preview screen renders. Counts first, detail bounded. */
function summarise(plan: ImportPlan) {
  const SAMPLE = 25;
  return {
    counts: {
      create: plan.creates.length,
      update: plan.updates.length,
      deactivate: plan.deactivates.length,
      unchanged: plan.unchangedCount,
      newTutors: plan.newTutorInitials.length,
    },
    creates: plan.creates.slice(0, SAMPLE).map((c) => c.record),
    updates: plan.updates.slice(0, SAMPLE).map((u) => ({
      enrollNo: u.enrollNo,
      fullName: u.record.fullName,
      changes: u.changes,
    })),
    // Deactivations are listed in full: nobody should approve removing
    // people they cannot see.
    deactivates: plan.deactivates,
    newTutorInitials: plan.newTutorInitials,
    truncated: {
      creates: Math.max(0, plan.creates.length - SAMPLE),
      updates: Math.max(0, plan.updates.length - SAMPLE),
    },
  };
}
