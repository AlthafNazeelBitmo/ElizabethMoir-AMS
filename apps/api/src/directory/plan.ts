import { createHash } from "node:crypto";
import type { DirectoryRecord } from "./provider.js";

/**
 * Working out what an import would change, before anything is written.
 *
 * Pure: given what is in the directory and what is in the file, it produces
 * the diff an administrator confirms. The preview they approve and the
 * changes that are applied come from this one function, so the screen
 * cannot describe something different from what happens.
 */

export interface ExistingPerson {
  id: string;
  enrollNo: string;
  fullName: string;
  groupName: string | null;
  tutorInitials: string | null;
  admissionNo: string | null;
  isActive: boolean;
}

export interface PlannedCreate {
  record: DirectoryRecord;
}

export interface PlannedUpdate {
  personId: string;
  enrollNo: string;
  record: DirectoryRecord;
  /** Field-level before/after, for the preview and the audit entry. */
  changes: Array<{
    field: string;
    before: string | null;
    after: string | null;
  }>;
}

export interface PlannedDeactivate {
  personId: string;
  enrollNo: string;
  fullName: string;
}

export interface ImportPlan {
  creates: PlannedCreate[];
  updates: PlannedUpdate[];
  deactivates: PlannedDeactivate[];
  /** Already correct, listed only as a count. */
  unchangedCount: number;
  /** Tutors named in the file that do not exist yet and will be created. */
  newTutorInitials: string[];
  /** Rows with no group: in the directory, off the register until given one. */
  ungroupedCount: number;
  /**
   * Identifies exactly this plan. The confirm step recomputes the plan and
   * compares: if the directory changed in between, the administrator is
   * shown the new diff rather than silently applying a stale one.
   */
  hash: string;
}

export function planImport(
  records: readonly DirectoryRecord[],
  existing: readonly ExistingPerson[],
  knownTutorInitials: readonly string[],
): ImportPlan {
  const byEnroll = new Map(existing.map((p) => [p.enrollNo, p]));
  const inFile = new Set(records.map((r) => r.enrollNo));

  const creates: PlannedCreate[] = [];
  const updates: PlannedUpdate[] = [];
  let unchangedCount = 0;

  for (const given of records) {
    const current = byEnroll.get(given.enrollNo);
    if (!current) {
      creates.push({ record: given });
      continue;
    }

    // A blank group or tutor in the file means the source does not know,
    // not that there is none: an export from the readers carries no
    // classification for many people, and a re-import must not undo what
    // the office has since set by hand. Clearing is done on the person's
    // own edit form, deliberately.
    const record: DirectoryRecord = {
      ...given,
      groupName: given.groupName ?? current.groupName,
      tutorInitials: given.tutorInitials ?? current.tutorInitials,
    };

    const changes = diff(current, record);
    if (changes.length === 0) {
      unchangedCount += 1;
      continue;
    }
    updates.push({
      personId: current.id,
      enrollNo: current.enrollNo,
      record,
      changes,
    });
  }

  // Anyone active in the directory but absent from the file. The
  // specification requires a separate, explicit confirmation for these,
  // because a truncated export should not quietly remove half the school.
  const deactivates: PlannedDeactivate[] = existing
    .filter((p) => p.isActive && !inFile.has(p.enrollNo))
    .map((p) => ({
      personId: p.id,
      enrollNo: p.enrollNo,
      fullName: p.fullName,
    }));

  const known = new Set(knownTutorInitials.map((t) => t.toLowerCase()));
  const newTutorInitials = [
    ...new Set(
      records
        .map((r) => r.tutorInitials)
        .filter((t): t is string => t !== null && !known.has(t.toLowerCase())),
    ),
  ].sort();

  const plan: Omit<ImportPlan, "hash"> = {
    creates,
    updates,
    deactivates,
    unchangedCount,
    newTutorInitials,
    ungroupedCount: records.filter((r) => r.groupName === null).length,
  };
  return { ...plan, hash: hashPlan(plan) };
}

/** A stable fingerprint of what the plan would do. Order-independent. */
export function hashPlan(plan: Omit<ImportPlan, "hash">): string {
  // Creates are fingerprinted by their whole content, not just the
  // enrolment number. Otherwise a file could be swapped between preview and
  // confirm for one with the same numbers and different names, and the
  // check that exists to prevent exactly that would pass.
  const material = JSON.stringify({
    creates: plan.creates.map((c) => describeRecord(c.record)).sort(),
    updates: plan.updates
      .map(
        (u) =>
          `${u.enrollNo}:${u.changes
            .map((c) => `${c.field}=${c.after ?? ""}`)
            .sort()
            .join(",")}`,
      )
      .sort(),
    deactivates: plan.deactivates.map((d) => d.enrollNo).sort(),
    newTutorInitials: [...plan.newTutorInitials].sort(),
  });
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/**
 * Every field of a record, so a fingerprint covers its whole content.
 * JSON rather than a joined string: no separator can then be forged by a
 * value that happens to contain it.
 */
function describeRecord(r: DirectoryRecord): string {
  return JSON.stringify([
    r.enrollNo,
    r.fullName,
    r.branch ?? "",
    r.groupName ?? "",
    r.tutorInitials ?? "",
    r.admissionNo ?? "",
  ]);
}

function diff(
  current: ExistingPerson,
  record: DirectoryRecord,
): PlannedUpdate["changes"] {
  const changes: PlannedUpdate["changes"] = [];
  const compare = (
    field: string,
    before: string | null,
    after: string | null,
  ) => {
    if ((before ?? "") !== (after ?? ""))
      changes.push({ field, before, after });
  };

  compare("full_name", current.fullName, record.fullName);
  compare("group", current.groupName, record.groupName);
  compare("tutor_initials", current.tutorInitials, record.tutorInitials);
  compare("admission_no", current.admissionNo, record.admissionNo);
  // Re-importing someone who had been deactivated brings them back.
  if (!current.isActive)
    changes.push({ field: "is_active", before: "false", after: "true" });

  return changes;
}
