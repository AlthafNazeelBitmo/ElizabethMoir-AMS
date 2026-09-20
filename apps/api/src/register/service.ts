import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { branchFilter, visibleBranches } from "../auth/scope.js";
import type { Db } from "../db/client.js";
import {
  calendarDays,
  dayRecords,
  groups,
  people,
  scans,
  tutors,
  type Branch,
  type DayStatus,
  type UserRole,
} from "../db/schema/index.js";
import { computeDayRecord } from "../domain/dayRecord.js";
import { instantAtLocalTime, parseTimeOfDay } from "../domain/time.js";
import type {
  AttendanceSettings,
  SettingsService,
} from "../settings/service.js";

/**
 * The register: who is expected today, and where they are.
 *
 * Every query composes the role's branch predicate rather than filtering
 * afterwards, so a `student_only` account cannot reach a staff row through
 * a parameter, a count, or a page of results.
 */

export interface RegisterRow {
  personId: string;
  enrollNo: string;
  fullName: string;
  branch: Branch | null;
  groupId: number | null;
  groupName: string | null;
  tutorInitials: string | null;
  dayRecordId: number | null;
  firstIn: string | null;
  lastOut: string | null;
  status: DayStatus;
  isLate: boolean;
  hasManualEdit: boolean;
  scanCount: number;
}

export interface RegisterFilters {
  date: string;
  branch?: Branch | undefined;
  groupId?: number | undefined;
  tutorId?: number | undefined;
  status?: DayStatus | undefined;
  q?: string | undefined;
}

export interface RegisterPage {
  rows: RegisterRow[];
  nextCursor: string | null;
  total: number;
}

export type StatusCounts = Record<DayStatus | "total" | "late", number>;

export class RegisterService {
  constructor(
    private readonly db: Db,
    private readonly settingsService: SettingsService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * One page of the register, ordered by name.
   *
   * The cursor is the last row's (name, id): a stable ordering that does not
   * shift when a scan changes someone's status mid-scroll, which offsets
   * would.
   */
  async live(
    role: UserRole,
    filters: RegisterFilters,
    limit: number,
    cursor: string | null,
  ): Promise<RegisterPage> {
    const settings = await this.settingsService.get();
    const dayContext = await this.dayContextFor(filters.date, settings);

    const where = await this.buildWhere(role, filters, cursor);

    const rows = await this.db
      .select({
        personId: people.id,
        enrollNo: people.enrollNo,
        fullName: people.fullName,
        branch: groups.branch,
        groupId: people.groupId,
        groupName: groups.name,
        expectsAttendance: groups.expectsAttendance,
        groupLateThreshold: groups.lateThreshold,
        tutorInitials: tutors.initials,
        dayRecordId: dayRecords.id,
        firstIn: dayRecords.firstIn,
        lastOut: dayRecords.lastOut,
        status: dayRecords.status,
        isLate: dayRecords.isLate,
        hasManualEdit: dayRecords.hasManualEdit,
        scanCount: dayRecords.scanCount,
      })
      .from(people)
      .leftJoin(groups, eq(groups.id, people.groupId))
      .leftJoin(tutors, eq(tutors.id, people.tutorId))
      .leftJoin(
        dayRecords,
        and(
          eq(dayRecords.personId, people.id),
          eq(dayRecords.date, filters.date),
        ),
      )
      .where(where)
      .orderBy(asc(people.fullName), asc(people.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const mapped = page
      .map((row) => this.toRegisterRow(row, dayContext, settings))
      // A status filter applies after synthesis, because someone with no
      // day record still has a status — that is the whole point of "absent".
      .filter((row) => matchesStatus(row, filters.status));

    const last = page.at(-1);
    const [total] = await this.db
      .select({ n: count() })
      .from(people)
      .leftJoin(groups, eq(groups.id, people.groupId))
      .leftJoin(tutors, eq(tutors.id, people.tutorId))
      .where(await this.buildWhere(role, filters, null));

    return {
      rows: mapped,
      nextCursor:
        hasMore && last ? encodeCursor(last.fullName, last.personId) : null,
      total: total?.n ?? 0,
    };
  }

  /** The counters above the table. Computed over the whole filtered set. */
  async summary(
    role: UserRole,
    filters: RegisterFilters,
  ): Promise<StatusCounts> {
    const settings = await this.settingsService.get();
    const dayContext = await this.dayContextFor(filters.date, settings);

    const rows = await this.db
      .select({
        personId: people.id,
        enrollNo: people.enrollNo,
        fullName: people.fullName,
        branch: groups.branch,
        groupId: people.groupId,
        groupName: groups.name,
        expectsAttendance: groups.expectsAttendance,
        groupLateThreshold: groups.lateThreshold,
        tutorInitials: tutors.initials,
        dayRecordId: dayRecords.id,
        firstIn: dayRecords.firstIn,
        lastOut: dayRecords.lastOut,
        status: dayRecords.status,
        isLate: dayRecords.isLate,
        hasManualEdit: dayRecords.hasManualEdit,
        scanCount: dayRecords.scanCount,
      })
      .from(people)
      .leftJoin(groups, eq(groups.id, people.groupId))
      .leftJoin(tutors, eq(tutors.id, people.tutorId))
      .leftJoin(
        dayRecords,
        and(
          eq(dayRecords.personId, people.id),
          eq(dayRecords.date, filters.date),
        ),
      )
      .where(
        await this.buildWhere(role, { ...filters, status: undefined }, null),
      );

    const counts: StatusCounts = {
      total: 0,
      on_site: 0,
      departed: 0,
      late: 0,
      absent: 0,
      not_expected: 0,
    };
    for (const raw of rows) {
      const row = this.toRegisterRow(raw, dayContext, settings);
      counts.total += 1;
      // On site and departed are presence, not status: someone who scanned
      // in on a day they were not expected — a Sunday, or a contractor — is
      // in the building all the same, and the register is about who is
      // here. Absent and not expected remain the day's verdict.
      if (isIn(row)) counts.on_site += 1;
      else if (isOut(row)) counts.departed += 1;
      if (row.status === "absent") counts.absent += 1;
      if (row.status === "not_expected") counts.not_expected += 1;
      if (row.isLate) counts.late += 1;
    }
    return counts;
  }

  /** Live counts beside each group in the left rail. */
  async groupCounts(
    role: UserRole,
    date: string,
  ): Promise<
    Array<{
      groupId: number;
      name: string;
      branch: Branch;
      onSite: number;
      total: number;
    }>
  > {
    const settings = await this.settingsService.get();
    const dayContext = await this.dayContextFor(date, settings);

    const rows = await this.db
      .select({
        personId: people.id,
        enrollNo: people.enrollNo,
        fullName: people.fullName,
        branch: groups.branch,
        groupId: groups.id,
        groupName: groups.name,
        groupOrder: groups.displayOrder,
        groupActive: groups.isActive,
        expectsAttendance: groups.expectsAttendance,
        groupLateThreshold: groups.lateThreshold,
        tutorInitials: tutors.initials,
        dayRecordId: dayRecords.id,
        firstIn: dayRecords.firstIn,
        lastOut: dayRecords.lastOut,
        status: dayRecords.status,
        isLate: dayRecords.isLate,
        hasManualEdit: dayRecords.hasManualEdit,
        scanCount: dayRecords.scanCount,
      })
      .from(people)
      .innerJoin(groups, eq(groups.id, people.groupId))
      .leftJoin(tutors, eq(tutors.id, people.tutorId))
      .leftJoin(
        dayRecords,
        and(eq(dayRecords.personId, people.id), eq(dayRecords.date, date)),
      )
      .where(and(branchFilter(role), eq(people.isActive, true)));

    const byGroup = new Map<
      number,
      {
        groupId: number;
        name: string;
        branch: Branch;
        order: number;
        onSite: number;
        total: number;
      }
    >();

    // Every active group the role may see is on the rail, people or not:
    // a form whose pupils have not been imported yet reads 0/0, which is
    // true, rather than vanishing, which looks like a fault. On a fresh
    // deployment this is the whole rail.
    const active = await this.db
      .select({
        id: groups.id,
        name: groups.name,
        branch: groups.branch,
        order: groups.displayOrder,
      })
      .from(groups)
      .where(
        and(
          eq(groups.isActive, true),
          inArray(groups.branch, [...visibleBranches(role)]),
        ),
      );
    for (const group of active) {
      byGroup.set(group.id, {
        groupId: group.id,
        name: group.name,
        branch: group.branch,
        order: group.order,
        onSite: 0,
        total: 0,
      });
    }

    for (const raw of rows) {
      if (raw.groupId === null || raw.branch === null || raw.groupName === null)
        continue;
      // A deactivated group leaves the rail; its people stay in the register.
      if (!raw.groupActive) continue;
      const entry = byGroup.get(raw.groupId) ?? {
        groupId: raw.groupId,
        name: raw.groupName,
        branch: raw.branch,
        order: raw.groupOrder ?? 0,
        onSite: 0,
        total: 0,
      };
      entry.total += 1;
      const row = this.toRegisterRow(raw, dayContext, settings);
      if (isIn(row)) entry.onSite += 1;
      byGroup.set(raw.groupId, entry);
    }
    // In the order the school chose, so "Form 10" does not sit between
    // "Form 1" and "Form 2"; the name only breaks ties.
    return [...byGroup.values()]
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map(({ order: _order, ...group }) => group);
  }

  /** One person, for the side panel. Role-scoped: 404 rather than 403. */
  async person(role: UserRole, personId: string) {
    const [row] = await this.db
      .select({
        id: people.id,
        enrollNo: people.enrollNo,
        fullName: people.fullName,
        admissionNo: people.admissionNo,
        photoUrl: people.photoUrl,
        isActive: people.isActive,
        branch: groups.branch,
        groupId: groups.id,
        groupName: groups.name,
        tutorInitials: tutors.initials,
      })
      .from(people)
      .leftJoin(groups, eq(groups.id, people.groupId))
      .leftJoin(tutors, eq(tutors.id, people.tutorId))
      .where(and(eq(people.id, personId), branchFilter(role)))
      .limit(1);
    return row ?? null;
  }

  /** A person's scans in a window, newest first. */
  async personScans(
    role: UserRole,
    personId: string,
    from: string,
    to: string,
  ) {
    const visible = await this.person(role, personId);
    if (!visible) return null;
    return this.db
      .select({
        id: scans.id,
        attTime: scans.attTime,
        attTimeLocal: scans.attTimeLocal,
        direction: scans.direction,
        directionSource: scans.directionSource,
        deviceSerial: scans.deviceSerial,
        checkingStatus: scans.checkingStatus,
      })
      .from(scans)
      .where(
        and(
          eq(scans.personId, personId),
          gte(scans.attTime, new Date(`${from}T00:00:00.000Z`)),
          lte(scans.attTime, new Date(`${to}T23:59:59.999Z`)),
        ),
      )
      .orderBy(asc(scans.attTime));
  }

  /** A person's recent day records, for the panel's history. */
  async personDays(role: UserRole, personId: string, from: string, to: string) {
    const visible = await this.person(role, personId);
    if (!visible) return null;
    return this.db
      .select()
      .from(dayRecords)
      .where(
        and(
          eq(dayRecords.personId, personId),
          gte(dayRecords.date, from),
          lte(dayRecords.date, to),
        ),
      )
      .orderBy(asc(dayRecords.date));
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async buildWhere(
    role: UserRole,
    filters: RegisterFilters,
    cursor: string | null,
  ): Promise<SQL | undefined> {
    const decoded = cursor ? decodeCursor(cursor) : null;
    const conditions: Array<SQL | undefined> = [
      branchFilter(role),
      eq(people.isActive, true),
      filters.branch ? eq(groups.branch, filters.branch) : undefined,
      filters.groupId ? eq(people.groupId, filters.groupId) : undefined,
      filters.tutorId ? eq(people.tutorId, filters.tutorId) : undefined,
      filters.q
        ? or(
            ilike(people.fullName, `%${filters.q}%`),
            ilike(people.enrollNo, `%${filters.q}%`),
          )
        : undefined,
      decoded
        ? or(
            gt(people.fullName, decoded.fullName),
            and(
              eq(people.fullName, decoded.fullName),
              gt(people.id, decoded.personId),
            ),
          )
        : undefined,
    ];
    const present = conditions.filter((c): c is SQL => c !== undefined);
    return present.length > 0 ? and(...present) : undefined;
  }

  /** Whether this date is a school day, and when absence becomes meaningful. */
  private async dayContextFor(date: string, settings: AttendanceSettings) {
    const [calendar] = await this.db
      .select({ type: calendarDays.type })
      .from(calendarDays)
      .where(eq(calendarDays.date, date))
      .limit(1);

    return {
      isSchoolDay:
        calendar?.type === "school_day" || calendar?.type === "exception",
      absenceDecidedFrom:
        instantAtLocalTime(
          date,
          settings.absenceDecidedAfter,
          settings.timezone,
        ) ?? new Date(0),
    };
  }

  /**
   * Builds the row the register shows.
   *
   * Somebody with no day record still belongs on the screen — that is what
   * "absent" means. Rather than inventing a second set of rules here, the
   * same `computeDayRecord` the processor uses is called with no scans, so
   * the register and the stored record can never disagree about what an
   * empty day means.
   */
  private toRegisterRow(
    raw: {
      personId: string;
      enrollNo: string;
      fullName: string;
      branch: Branch | null;
      groupId: number | null;
      groupName: string | null;
      expectsAttendance: boolean | null;
      groupLateThreshold: string | null;
      tutorInitials: string | null;
      dayRecordId: number | null;
      firstIn: Date | null;
      lastOut: Date | null;
      status: DayStatus | null;
      isLate: boolean | null;
      hasManualEdit: boolean | null;
      scanCount: number | null;
    },
    dayContext: { isSchoolDay: boolean; absenceDecidedFrom: Date },
    _settings: AttendanceSettings,
  ): RegisterRow {
    const base = {
      personId: raw.personId,
      enrollNo: raw.enrollNo,
      fullName: raw.fullName,
      branch: raw.branch,
      groupId: raw.groupId,
      groupName: raw.groupName,
      tutorInitials: raw.tutorInitials,
    };

    if (raw.status !== null) {
      return {
        ...base,
        dayRecordId: raw.dayRecordId,
        firstIn: raw.firstIn?.toISOString() ?? null,
        lastOut: raw.lastOut?.toISOString() ?? null,
        status: raw.status,
        isLate: raw.isLate ?? false,
        hasManualEdit: raw.hasManualEdit ?? false,
        scanCount: raw.scanCount ?? 0,
      };
    }

    const computed = computeDayRecord([], {
      expectsAttendance:
        raw.groupId === null ? false : (raw.expectsAttendance ?? false),
      isSchoolDay: dayContext.isSchoolDay,
      lateThreshold: null,
      absenceDecidedFrom: dayContext.absenceDecidedFrom,
      now: this.now(),
    });

    return {
      ...base,
      dayRecordId: null,
      firstIn: null,
      lastOut: null,
      // Null means the day has not reached the point where absence is
      // meaningful; nothing has happened yet, which reads as not expected.
      status: computed?.status ?? "not_expected",
      isLate: false,
      hasManualEdit: false,
      scanCount: 0,
    };
  }
}

export function encodeCursor(fullName: string, personId: string): string {
  return Buffer.from(JSON.stringify([fullName, personId]), "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(
  cursor: string,
): { fullName: string; personId: string } | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { fullName: parsed[0], personId: parsed[1] };
    }
  } catch {
    // A malformed cursor is treated as no cursor rather than an error: it
    // is almost always a stale bookmark, not an attack.
  }
  return null;
}

/** Scanned in and not yet out, whatever the day's verdict. */
export function isIn(row: { firstIn: string | null; lastOut: string | null }): boolean {
  return row.firstIn !== null && row.lastOut === null;
}

/** Scanned out. */
export function isOut(row: { lastOut: string | null }): boolean {
  return row.lastOut !== null;
}

/**
 * The status filter, in the same terms as the counts: on site and departed
 * are presence, the rest the day's status, late the flag.
 */
export function matchesStatus(
  row: { status: DayStatus; isLate: boolean; firstIn: string | null; lastOut: string | null },
  status: DayStatus | undefined,
): boolean {
  switch (status) {
    case undefined:
      return true;
    case "on_site":
      return isIn(row);
    case "departed":
      return isOut(row);
    case "late":
      return row.isLate;
    default:
      return row.status === status;
  }
}
