import { and, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import {
  groups,
  people,
  type Branch,
  type UserRole,
} from "../db/schema/index.js";

/**
 * Which branches a role may see.
 *
 * A `student_only` user must not obtain a single staff record from any
 * endpoint, by any parameter, in any export, ever (specification §9). That
 * is enforced by composing the predicate below into every query that can
 * reach a person — never by filtering a result set afterwards, because a
 * response mapper cannot protect a count, an aggregate, or a CSV export.
 */
export function visibleBranches(role: UserRole): readonly Branch[] {
  return role === "full" ? ["student", "staff"] : ["student"];
}

export function canSeeStaff(role: UserRole): boolean {
  return visibleBranches(role).includes("staff");
}

/**
 * The predicate restricting a `people`-joined-`groups` query to what the
 * role may see. Intended to be `and()`-ed into the query's WHERE clause.
 *
 * A `full` user gets no restriction. A `student_only` user gets rows whose
 * group is in the student branch — which deliberately also excludes people
 * with **no group at all**. An unassigned person might be staff; until
 * somebody classifies them, showing them to a student-only account would be
 * a guess, and the wrong guess leaks. They appear in the admin screens,
 * where they can be given a group.
 */
export function branchFilter(role: UserRole): SQL | undefined {
  if (canSeeStaff(role)) return undefined;
  return and(
    isNotNull(people.groupId),
    inArray(groups.branch, [...visibleBranches(role)]),
  );
}

/**
 * The join every person query must use, so `branchFilter` has a `groups` row
 * to test. A LEFT join keeps ungrouped people visible to `full` users while
 * `branchFilter` removes them for everyone else.
 */
export const peopleGroupJoin = {
  table: groups,
  on: eq(groups.id, people.groupId),
} as const;
