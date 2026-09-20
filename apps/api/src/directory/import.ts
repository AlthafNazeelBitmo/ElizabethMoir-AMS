import { eq, inArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { writeAudit, writeAudits, type AuditEntry } from "../audit.js";
import type { Db } from "../db/client.js";
import { groups, people, tutors } from "../db/schema/index.js";
import type { CsvProblem } from "./csv.js";
import { planImport, type ExistingPerson, type ImportPlan } from "./plan.js";
import { validateDirectoryCsv, type KnownGroup } from "./validate.js";

/**
 * Importing the school's directory.
 *
 * Two steps, as the specification requires: build a plan and show it, then
 * apply exactly that plan once someone has confirmed it. The plan is
 * rebuilt from scratch at confirm time and its fingerprint compared, so an
 * administrator can never approve one diff and have a different one applied
 * because the directory moved underneath them.
 *
 * Applying is all-or-nothing: everything happens in one transaction, so a
 * failure half way through leaves the directory exactly as it was.
 */

export interface BuildPlanResult {
  plan: ImportPlan | null;
  problems: CsvProblem[];
}

export interface ApplyOptions {
  /**
   * What to do about people who are active but absent from the file.
   * "confirm": deactivate them — the file is the whole school, and this is
   * the explicit consent the specification requires (§6). "skip": leave
   * them — the file is a part of the school, the staff list say, and its
   * silence about everyone else means nothing. "ask" (the default): refuse
   * until one of the two is said.
   */
  deactivations: "ask" | "confirm" | "skip";
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

export interface ApplyResult {
  created: number;
  updated: number;
  deactivated: number;
  tutorsCreated: number;
}

export class DirectoryImporter {
  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Validates the file and works out what it would change. Writes nothing. */
  async buildPlan(csvText: string): Promise<BuildPlanResult> {
    const knownGroups = await this.loadGroups();
    const { records, problems } = validateDirectoryCsv(csvText, knownGroups);

    // A single bad row stops the whole import: the specification requires
    // all-or-nothing, and a partial directory is worse than none.
    if (problems.length > 0) return { plan: null, problems };

    const existing = await this.loadExistingPeople();
    const knownTutors = await this.db
      .select({ initials: tutors.initials })
      .from(tutors);
    return {
      plan: planImport(
        records,
        existing,
        knownTutors.map((t) => t.initials),
      ),
      problems: [],
    };
  }

  /**
   * Applies a plan whose fingerprint still matches the current state.
   * Returns null when it no longer does, with the freshly built plan so the
   * caller can show what changed.
   */
  async apply(
    csvText: string,
    expectedHash: string,
    options: ApplyOptions,
  ): Promise<
    | { ok: true; result: ApplyResult; plan: ImportPlan }
    | {
        ok: false;
        reason: "stale";
        plan: ImportPlan | null;
        problems: CsvProblem[];
      }
    | { ok: false; reason: "needs_deactivation_confirmation"; plan: ImportPlan }
    | { ok: false; reason: "invalid"; plan: null; problems: CsvProblem[] }
  > {
    const { plan, problems } = await this.buildPlan(csvText);
    if (plan === null)
      return { ok: false, reason: "invalid", plan: null, problems };

    if (plan.hash !== expectedHash) {
      return { ok: false, reason: "stale", plan, problems: [] };
    }
    if (plan.deactivates.length > 0 && options.deactivations === "ask") {
      return { ok: false, reason: "needs_deactivation_confirmation", plan };
    }

    // A partial file: the plan as previewed, minus the people it was silent
    // about. The fingerprint was checked against the whole plan above, so
    // what is applied is still exactly what was shown.
    const applied =
      options.deactivations === "skip" ? { ...plan, deactivates: [] } : plan;
    const result = await this.applyPlan(applied, options);
    return { ok: true, result, plan };
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async applyPlan(
    plan: ImportPlan,
    options: ApplyOptions,
  ): Promise<ApplyResult> {
    const audits: AuditEntry[] = [];

    const result = await this.db.transaction(async (tx) => {
      // Tutors first: people reference them.
      if (plan.newTutorInitials.length > 0) {
        await tx
          .insert(tutors)
          .values(plan.newTutorInitials.map((initials) => ({ initials })))
          .onConflictDoNothing({ target: tutors.initials });
      }

      const groupIds = await this.groupIdsByName(tx);
      const tutorIds = await this.tutorIdsByInitials(tx);
      const now = new Date();

      // A whole school at once, in a few statements: one row at a time is
      // hundreds of round trips, more than a serverless request is allowed.
      const BATCH = 200;
      for (let i = 0; i < plan.creates.length; i += BATCH) {
        const slice = plan.creates.slice(i, i + BATCH);
        const rows = await tx
          .insert(people)
          .values(
            slice.map((create) => ({
              enrollNo: create.record.enrollNo,
              fullName: create.record.fullName,
              groupId: create.record.groupName
                ? (groupIds.get(normalise(create.record.groupName)) ?? null)
                : null,
              tutorId: create.record.tutorInitials
                ? (tutorIds.get(create.record.tutorInitials.toLowerCase()) ??
                  null)
                : null,
              admissionNo: create.record.admissionNo,
              displayOrder: create.record.displayOrder,
            })),
          )
          .returning({ id: people.id, enrollNo: people.enrollNo });
        const idByEnroll = new Map(rows.map((r) => [r.enrollNo, r.id]));
        for (const create of slice) {
          audits.push({
            action: "person_created",
            userId: options.userId,
            entity: "person",
            entityId: idByEnroll.get(create.record.enrollNo) ?? create.record.enrollNo,
            after: create.record,
            ip: options.ip,
            userAgent: options.userAgent,
            createdAt: now,
          });
        }
      }

      for (const update of plan.updates) {
        await tx
          .update(people)
          .set({
            fullName: update.record.fullName,
            groupId: update.record.groupName
              ? (groupIds.get(normalise(update.record.groupName)) ?? null)
              : null,
            tutorId: update.record.tutorInitials
              ? (tutorIds.get(update.record.tutorInitials.toLowerCase()) ??
                null)
              : null,
            admissionNo: update.record.admissionNo,
            displayOrder: update.record.displayOrder,
            isActive: true,
            updatedAt: now,
          })
          .where(eq(people.id, update.personId));
        audits.push({
          action: "person_modified",
          userId: options.userId,
          entity: "person",
          entityId: update.personId,
          before: Object.fromEntries(
            update.changes.map((c) => [c.field, c.before]),
          ),
          after: Object.fromEntries(
            update.changes.map((c) => [c.field, c.after]),
          ),
          ip: options.ip,
          userAgent: options.userAgent,
          createdAt: now,
        });
      }

      if (plan.deactivates.length > 0) {
        await tx
          .update(people)
          .set({ isActive: false, updatedAt: now })
          .where(
            inArray(
              people.id,
              plan.deactivates.map((d) => d.personId),
            ),
          );
        for (const d of plan.deactivates) {
          audits.push({
            action: "person_deactivated",
            userId: options.userId,
            entity: "person",
            entityId: d.personId,
            before: {
              enroll_no: d.enrollNo,
              full_name: d.fullName,
              is_active: true,
            },
            after: { is_active: false },
            ip: options.ip,
            userAgent: options.userAgent,
            createdAt: now,
          });
        }
      }

      return {
        created: plan.creates.length,
        updated: plan.updates.length,
        deactivated: plan.deactivates.length,
        tutorsCreated: plan.newTutorInitials.length,
      };
    });

    // Audited after the transaction commits: an entry describing a change
    // that was rolled back would be a lie, and the audit table is
    // append-only so it could never be corrected.
    await writeAudit(this.db, this.log, {
      action: "csv_import",
      userId: options.userId,
      entity: "directory",
      after: { ...result, planHash: plan.hash },
      ip: options.ip,
      userAgent: options.userAgent,
    });
    await writeAudits(this.db, this.log, audits);

    return result;
  }

  private async loadGroups(): Promise<KnownGroup[]> {
    return this.db
      .select({ id: groups.id, name: groups.name, branch: groups.branch })
      .from(groups)
      .where(eq(groups.isActive, true));
  }

  private async loadExistingPeople(): Promise<ExistingPerson[]> {
    const rows = await this.db
      .select({
        id: people.id,
        enrollNo: people.enrollNo,
        fullName: people.fullName,
        groupName: groups.name,
        tutorInitials: tutors.initials,
        admissionNo: people.admissionNo,
        displayOrder: people.displayOrder,
        isActive: people.isActive,
      })
      .from(people)
      .leftJoin(groups, eq(groups.id, people.groupId))
      .leftJoin(tutors, eq(tutors.id, people.tutorId));
    return rows;
  }

  private async groupIdsByName(tx: Db): Promise<Map<string, number>> {
    const rows = await tx
      .select({ id: groups.id, name: groups.name })
      .from(groups);
    return new Map(rows.map((r) => [normalise(r.name), r.id]));
  }

  private async tutorIdsByInitials(tx: Db): Promise<Map<string, number>> {
    const rows = await tx
      .select({ id: tutors.id, initials: tutors.initials })
      .from(tutors);
    return new Map(rows.map((r) => [r.initials.toLowerCase(), r.id]));
  }
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
