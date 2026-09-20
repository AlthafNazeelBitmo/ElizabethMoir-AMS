import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
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
  dayRecords,
  devices,
  groups,
  manualAdjustments,
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
  /** A group's id, or "none" for the people who are in no group. */
  groupId: z
    .union([z.literal("none"), z.coerce.number().int()])
    .optional(),
  tutorId: z.coerce.number().int().optional(),
  /** Which people: the active ones (default), the deactivated ones, or all. */
  active: z.enum(["true", "false", "all"]).default("true"),
  /** The older spelling of `active=all`, kept for scripts. */
  includeInactive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default(false),
});

const upsertTutor = z.object({
  initials: z.string().trim().min(1).max(8),
  fullName: z.string().trim().max(200).nullable().optional(),
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
    const { page, limit, q, branch, groupId, tutorId, includeInactive } =
      parsed.data;
    const active = includeInactive ? "all" : parsed.data.active;

    const conditions = [
      // Even on an admin endpoint the branch predicate is composed in, so
      // the rule holds if this route is ever opened to another role.
      branchFilter(req.auth!.role),
      active === "all" ? undefined : eq(people.isActive, active === "true"),
      branch ? eq(groups.branch, branch) : undefined,
      groupId === "none"
        ? isNull(people.groupId)
        : groupId
          ? eq(people.groupId, groupId)
          : undefined,
      tutorId ? eq(people.tutorId, tutorId) : undefined,
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
        tutorId: people.tutorId,
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

    // Scans that arrived under this number before anyone knew who it was
    // belong to them now, exactly as when a name is given under Unknown
    // IDs. Adding a person by hand must not leave their morning orphaned.
    const daysRecomputed = await processor.claimScansFor(row!.id, row!.enrollNo);

    await writeAudit(db, req.log, {
      action: "person_created",
      userId: req.auth!.userId,
      entity: "person",
      entityId: row!.id,
      after: { ...parsed.data, daysRecomputed },
      ip: req.ip || null,
      userAgent: req.headers["user-agent"] ?? null,
    });
    return reply.code(201).send({ person: row, daysRecomputed });
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

      // While they were deactivated their number belonged to nobody, so
      // anything it scanned in the meantime was stored unattached. Coming
      // back claims it, the same as being added would.
      const reactivated = !before.isActive && after!.isActive;
      const daysRecomputed = reactivated
        ? await processor.claimScansFor(after!.id, after!.enrollNo)
        : 0;

      await writeAudit(db, req.log, {
        action:
          parsed.data.isActive === false
            ? "person_deactivated"
            : "person_modified",
        userId: req.auth!.userId,
        entity: "person",
        entityId: req.params.id,
        before,
        after: reactivated ? { ...after, daysRecomputed } : after,
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });
      return reply.send({ person: after, daysRecomputed });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/admin/people/:id",
    { preHandler },
    async (req, reply) => {
      const [person] = await db
        .select()
        .from(people)
        .where(eq(people.id, req.params.id))
        .limit(1);
      if (!person)
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such person." });
      if (person.isActive) {
        // Two steps, always: off the register first, then gone. Nobody on
        // the register disappears in one click.
        return reply.code(409).send({
          error: "still_active",
          message: `${person.fullName} is still active. Deactivate them first; deletion is for people who have already left.`,
        });
      }

      // Everything computed for them goes; the raw deliveries from the
      // readers stay, so nothing the readers said is lost, and if the card
      // is ever used again the number comes up under Unknown IDs.
      const counts = await db.transaction(async (tx) => {
        const days = await tx
          .select({ id: dayRecords.id })
          .from(dayRecords)
          .where(eq(dayRecords.personId, person.id));
        if (days.length > 0) {
          await tx.delete(manualAdjustments).where(
            inArray(
              manualAdjustments.dayRecordId,
              days.map((d) => d.id),
            ),
          );
          await tx.delete(dayRecords).where(eq(dayRecords.personId, person.id));
        }
        const removedScans = await tx
          .delete(scans)
          .where(eq(scans.personId, person.id))
          .returning({ id: scans.id });
        await tx
          .delete(unknownEnrollments)
          .where(eq(unknownEnrollments.enrollNo, person.enrollNo));
        await tx.delete(people).where(eq(people.id, person.id));
        return { dayRecords: days.length, scans: removedScans.length };
      });

      await writeAudit(db, req.log, {
        action: "person_deleted",
        userId: req.auth!.userId,
        entity: "person",
        entityId: person.id,
        before: person,
        after: { deleted: counts },
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });
      return reply.send({ deleted: counts });
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
        // The readers have usually been sending for days by the time the
        // spreadsheet arrives: everything stored under a number that now
        // has a name is claimed for them straight away.
        const matched = await processor.matchUnknownToDirectory();
        return reply.send({ result: outcome.result, matched });
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
      // A number on this list may still be a deactivated person's: their
      // card kept working after they were removed. The row says whose it
      // was, so the office can reactivate them rather than invent a twin.
      const rows = await db
        .select({
          enrollNo: unknownEnrollments.enrollNo,
          firstSeenAt: unknownEnrollments.firstSeenAt,
          lastSeenAt: unknownEnrollments.lastSeenAt,
          scanCount: unknownEnrollments.scanCount,
          formerPersonId: people.id,
          formerName: people.fullName,
        })
        .from(unknownEnrollments)
        .leftJoin(
          people,
          and(
            eq(people.enrollNo, unknownEnrollments.enrollNo),
            eq(people.isActive, false),
          ),
        )
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

  app.post(
    "/api/admin/unknown-enrollments/match",
    { preHandler },
    async (req, reply) => {
      const matched = await processor.matchUnknownToDirectory();
      if (matched.people > 0) {
        await writeAudit(db, req.log, {
          action: "unknown_matched",
          userId: req.auth!.userId,
          entity: "unknown_enrollment",
          entityId: null,
          after: matched,
          ip: req.ip || null,
          userAgent: req.headers["user-agent"] ?? null,
        });
      }
      return reply.send({ matched });
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
        if (!person.isActive) {
          // Their own number, scanned after they were deactivated. Attaching
          // it to them is reactivating them; anything less would leave the
          // register hiding the scans it has just been given.
          await db
            .update(people)
            .set({ isActive: true, updatedAt: new Date() })
            .where(eq(people.id, person.id));
          await writeAudit(db, req.log, {
            action: "person_modified",
            userId: req.auth!.userId,
            entity: "person",
            entityId: person.id,
            before: person,
            after: { ...person, isActive: true },
            ip: req.ip || null,
            userAgent: req.headers["user-agent"] ?? null,
          });
        }
        personId = person.id;
      } else {
        const [holder] = await db
          .select({ id: people.id, fullName: people.fullName })
          .from(people)
          .where(eq(people.enrollNo, enrollNo))
          .limit(1);
        if (holder) {
          // The number is a deactivated person's (an active one would have
          // matched at the reader). A second person with the same number
          // is not possible, and would be the wrong answer if it were.
          return reply.code(409).send({
            error: "number_held_by_deactivated",
            message: `Enrolment number ${enrollNo} belongs to ${holder.fullName}, who is deactivated. Reactivate them under People instead of creating someone new.`,
            personId: holder.id,
          });
        }
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
      const daysRecomputed = await processor.claimScansFor(personId, enrollNo);

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

  // ── Tutors ──────────────────────────────────────────────────────────────
  //
  // A tutor is a pair of initials and, optionally, a name; the spreadsheet
  // creates them as it meets them, and these routes let the office keep
  // the list right between imports. People are counted so a tutor is not
  // removed from under them.

  app.get("/api/admin/tutors", { preHandler }, async (_req, reply) => {
    const rows = await db
      .select({
        id: tutors.id,
        initials: tutors.initials,
        fullName: tutors.fullName,
        peopleCount: count(people.id),
      })
      .from(tutors)
      .leftJoin(
        people,
        and(eq(people.tutorId, tutors.id), eq(people.isActive, true)),
      )
      .groupBy(tutors.id)
      .orderBy(asc(tutors.initials));
    return reply.send({ tutors: rows });
  });

  app.post("/api/admin/tutors", { preHandler }, async (req, reply) => {
    const parsed = upsertTutor.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "Initials are required, up to eight characters.",
      });
    }
    const initials = parsed.data.initials.toUpperCase();
    const clash = await db
      .select({ id: tutors.id })
      .from(tutors)
      // Initials are letters, so a pattern-free ilike is a case-blind equals.
      .where(ilike(tutors.initials, initials))
      .limit(1);
    if (clash.length > 0) {
      return reply.code(409).send({
        error: "duplicate",
        message: `There is already a tutor with the initials ${initials}.`,
      });
    }
    const [row] = await db
      .insert(tutors)
      .values({ initials, fullName: parsed.data.fullName ?? null })
      .returning();
    await writeAudit(db, req.log, {
      action: "tutor_created",
      userId: req.auth!.userId,
      entity: "tutor",
      entityId: String(row!.id),
      after: row,
      ip: req.ip || null,
      userAgent: req.headers["user-agent"] ?? null,
    });
    return reply.code(201).send({ tutor: { ...row, peopleCount: 0 } });
  });

  app.patch<{ Params: { id: string } }>(
    "/api/admin/tutors/:id",
    { preHandler },
    async (req, reply) => {
      const parsed = upsertTutor.partial().safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "Check the values." });
      }
      const id = Number(req.params.id);
      const [before] = await db
        .select()
        .from(tutors)
        .where(eq(tutors.id, id))
        .limit(1);
      if (!before)
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such tutor." });

      const changes: Partial<typeof tutors.$inferInsert> = {};
      if (parsed.data.initials !== undefined) {
        const initials = parsed.data.initials.toUpperCase();
        const clash = await db
          .select({ id: tutors.id })
          .from(tutors)
          .where(and(ilike(tutors.initials, initials), ne(tutors.id, id)))
          .limit(1);
        if (clash.length > 0) {
          return reply.code(409).send({
            error: "duplicate",
            message: `There is already a tutor with the initials ${initials}.`,
          });
        }
        changes.initials = initials;
      }
      if (parsed.data.fullName !== undefined)
        changes.fullName = parsed.data.fullName;

      const [after] = await db
        .update(tutors)
        .set(changes)
        .where(eq(tutors.id, id))
        .returning();
      await writeAudit(db, req.log, {
        action: "tutor_modified",
        userId: req.auth!.userId,
        entity: "tutor",
        entityId: String(id),
        before,
        after,
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });
      return reply.send({ tutor: after });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/admin/tutors/:id",
    { preHandler },
    async (req, reply) => {
      const id = Number(req.params.id);
      const [tutor] = await db
        .select()
        .from(tutors)
        .where(eq(tutors.id, id))
        .limit(1);
      if (!tutor)
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such tutor." });

      // Active or not: a deactivated person's history still names them.
      const [assigned] = await db
        .select({ n: count() })
        .from(people)
        .where(eq(people.tutorId, id));
      if ((assigned?.n ?? 0) > 0) {
        return reply.code(409).send({
          error: "in_use",
          message: `${tutor.initials} is the tutor of ${assigned!.n} ${assigned!.n === 1 ? "person" : "people"}. Move them to another tutor first (filter People by tutor).`,
          peopleCount: assigned!.n,
        });
      }

      await db.delete(tutors).where(eq(tutors.id, id));
      await writeAudit(db, req.log, {
        action: "tutor_deleted",
        userId: req.auth!.userId,
        entity: "tutor",
        entityId: String(id),
        before: tutor,
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });
      return reply.code(204).send();
    },
  );
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
      ungrouped: plan.ungroupedCount,
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
