import { and, asc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { branchFilter } from "../auth/scope.js";
import type { Db } from "../db/client.js";
import {
  calendarDays,
  dayRecords,
  groups,
  people,
  tutors,
  type Branch,
  type UserRole,
} from "../db/schema/index.js";
import type { SettingsService } from "../settings/service.js";

/**
 * Attendance over a date range.
 *
 * Every figure here is derived from `day_records`, which is itself derived
 * from `scans`. Nothing is counted twice and nothing is counted that a
 * person could not have been expected for — the gate for this phase is that
 * these numbers reconcile against the raw scans, so the definitions matter
 * more than the query does.
 *
 *   present   the day was a school day, they were expected, and they came
 *   absent    the day was a school day, they were expected, and they did not
 *   expected  present + absent — the denominator, never the calendar length
 *
 * A day nobody expected them for (a holiday, a contractor, a date the
 * calendar does not know) counts in neither, so it cannot move a percentage.
 */

export interface ReportFilters {
  from: string;
  to: string;
  branch?: Branch | undefined;
  groupId?: number | undefined;
  tutorId?: number | undefined;
  /** One person only — the per-person report, computed by the same rules. */
  personId?: string | undefined;
}

export interface PersonReportRow {
  personId: string;
  enrollNo: string;
  fullName: string;
  groupName: string | null;
  branch: Branch | null;
  tutorInitials: string | null;
  daysPresent: number;
  daysAbsent: number;
  daysExpected: number;
  lateCount: number;
  /** Null when nothing was expected of them in the range. */
  attendancePercentage: number | null;
  /** Seconds after local midnight, averaged over the days they arrived. */
  averageArrivalSeconds: number | null;
}

export type PersonReport = NonNullable<
  Awaited<ReturnType<ReportService["person"]>>
>;

export interface AttendanceReport {
  from: string;
  to: string;
  schoolDaysInRange: number;
  rows: PersonReportRow[];
  totals: {
    people: number;
    daysPresent: number;
    daysAbsent: number;
    daysExpected: number;
    lateCount: number;
    attendancePercentage: number | null;
    averageArrivalSeconds: number | null;
  };
}

export class ReportService {
  constructor(
    private readonly db: Db,
    private readonly settingsService: SettingsService,
  ) {}

  async attendance(
    role: UserRole,
    filters: ReportFilters,
  ): Promise<AttendanceReport> {
    const settings = await this.settingsService.get();
    const timezone = settings.timezone;

    const conditions: Array<SQL | undefined> = [
      branchFilter(role),
      eq(people.isActive, true),
      filters.branch ? eq(groups.branch, filters.branch) : undefined,
      filters.groupId ? eq(people.groupId, filters.groupId) : undefined,
      filters.tutorId ? eq(people.tutorId, filters.tutorId) : undefined,
      filters.personId ? eq(people.id, filters.personId) : undefined,
    ];
    const present = conditions.filter((c): c is SQL => c !== undefined);
    const where = present.length > 0 ? and(...present) : undefined;

    // Counting happens in the database, but only over rows that fall inside
    // the range — the join condition, not a WHERE clause, so a person with
    // no records in the range still appears with zeroes rather than
    // vanishing from the report.
    const inRange = and(
      eq(dayRecords.personId, people.id),
      gte(dayRecords.date, filters.from),
      lte(dayRecords.date, filters.to),
    );

    // `first_in AT TIME ZONE <tz>` gives the school's wall clock; casting to
    // time and taking the epoch gives seconds after local midnight, which is
    // the only meaningful thing to average across days.
    const arrivalSeconds = sql<number | null>`avg(
      extract(epoch from (${dayRecords.firstIn} at time zone ${sql.raw(`'${timezone.replace(/'/g, "''")}'`)})::time)
    ) filter (where ${dayRecords.firstIn} is not null)`;

    const rows = await this.db
      .select({
        personId: people.id,
        enrollNo: people.enrollNo,
        fullName: people.fullName,
        groupName: groups.name,
        branch: groups.branch,
        tutorInitials: tutors.initials,
        daysPresent: sql<number>`count(*) filter (
          where ${dayRecords.status} in ('on_site', 'departed')
        )::int`,
        daysAbsent: sql<number>`count(*) filter (where ${dayRecords.status} = 'absent')::int`,
        lateCount: sql<number>`count(*) filter (where ${dayRecords.isLate})::int`,
        averageArrivalSeconds: arrivalSeconds,
      })
      .from(people)
      .leftJoin(groups, eq(groups.id, people.groupId))
      .leftJoin(tutors, eq(tutors.id, people.tutorId))
      .leftJoin(dayRecords, inRange)
      .where(where)
      .groupBy(
        people.id,
        people.enrollNo,
        people.fullName,
        groups.name,
        groups.branch,
        tutors.initials,
      )
      .orderBy(asc(people.fullName));

    const shaped: PersonReportRow[] = rows.map((row) => {
      const daysPresent = Number(row.daysPresent ?? 0);
      const daysAbsent = Number(row.daysAbsent ?? 0);
      const daysExpected = daysPresent + daysAbsent;
      const average = row.averageArrivalSeconds;
      return {
        personId: row.personId,
        enrollNo: row.enrollNo,
        fullName: row.fullName,
        groupName: row.groupName,
        branch: row.branch,
        tutorInitials: row.tutorInitials,
        daysPresent,
        daysAbsent,
        daysExpected,
        lateCount: Number(row.lateCount ?? 0),
        attendancePercentage:
          daysExpected === 0
            ? null
            : round((daysPresent / daysExpected) * 100, 1),
        averageArrivalSeconds:
          average === null ? null : Math.round(Number(average)),
      };
    });

    const [schoolDays] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(calendarDays)
      .where(
        and(
          gte(calendarDays.date, filters.from),
          lte(calendarDays.date, filters.to),
          sql`${calendarDays.type} in ('school_day', 'exception')`,
        ),
      );

    return {
      from: filters.from,
      to: filters.to,
      schoolDaysInRange: schoolDays?.n ?? 0,
      rows: shaped,
      totals: totalsOf(shaped),
    };
  }

  /**
   * Attendance by day across the range: how many were present, absent and
   * late on each school day, for the trend above the table. Same role and
   * filter rules as the table, so the chart and the rows agree.
   */
  async daily(
    role: UserRole,
    filters: ReportFilters,
  ): Promise<
    Array<{
      date: string;
      present: number;
      absent: number;
      late: number;
      expected: number;
    }>
  > {
    const conditions: Array<SQL | undefined> = [
      branchFilter(role),
      eq(people.isActive, true),
      filters.branch ? eq(groups.branch, filters.branch) : undefined,
      filters.groupId ? eq(people.groupId, filters.groupId) : undefined,
      filters.tutorId ? eq(people.tutorId, filters.tutorId) : undefined,
      filters.personId ? eq(people.id, filters.personId) : undefined,
      gte(dayRecords.date, filters.from),
      lte(dayRecords.date, filters.to),
    ];
    const present = conditions.filter((c): c is SQL => c !== undefined);

    const rows = await this.db
      .select({
        date: dayRecords.date,
        present: sql<number>`count(*) filter (
          where ${dayRecords.status} in ('on_site', 'departed')
        )::int`,
        absent: sql<number>`count(*) filter (where ${dayRecords.status} = 'absent')::int`,
        late: sql<number>`count(*) filter (where ${dayRecords.isLate})::int`,
      })
      .from(dayRecords)
      .innerJoin(people, eq(people.id, dayRecords.personId))
      .leftJoin(groups, eq(groups.id, people.groupId))
      .where(and(...present))
      .groupBy(dayRecords.date)
      .orderBy(asc(dayRecords.date));

    return rows.map((row) => {
      const p = Number(row.present ?? 0);
      const a = Number(row.absent ?? 0);
      return {
        date: row.date,
        present: p,
        absent: a,
        late: Number(row.late ?? 0),
        expected: p + a,
      };
    });
  }

  /** One person's day-by-day record, for the per-person report. */
  async person(role: UserRole, personId: string, from: string, to: string) {
    const [subject] = await this.db
      .select({
        id: people.id,
        enrollNo: people.enrollNo,
        fullName: people.fullName,
        groupName: groups.name,
        branch: groups.branch,
        tutorInitials: tutors.initials,
      })
      .from(people)
      .leftJoin(groups, eq(groups.id, people.groupId))
      .leftJoin(tutors, eq(tutors.id, people.tutorId))
      .where(and(eq(people.id, personId), branchFilter(role)))
      .limit(1);
    if (!subject) return null;

    const days = await this.db
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

    // The same query as the school-wide report, narrowed to one person, so
    // the figure here can never disagree with the figure on the main table.
    const summary = await this.attendance(role, { from, to, personId });
    return {
      person: subject,
      from,
      to,
      schoolDaysInRange: summary.schoolDaysInRange,
      days,
      summary: summary.rows[0] ?? null,
    };
  }
}

function totalsOf(
  rows: readonly PersonReportRow[],
): AttendanceReport["totals"] {
  const daysPresent = sum(rows, (r) => r.daysPresent);
  const daysAbsent = sum(rows, (r) => r.daysAbsent);
  const daysExpected = daysPresent + daysAbsent;

  // The aggregate arrival is weighted by the days each person actually
  // arrived, not a mean of means: someone present twice must not count the
  // same as someone present forty times.
  let arrivalWeight = 0;
  let arrivalTotal = 0;
  for (const row of rows) {
    if (row.averageArrivalSeconds === null || row.daysPresent === 0) continue;
    arrivalWeight += row.daysPresent;
    arrivalTotal += row.averageArrivalSeconds * row.daysPresent;
  }

  return {
    people: rows.length,
    daysPresent,
    daysAbsent,
    daysExpected,
    lateCount: sum(rows, (r) => r.lateCount),
    attendancePercentage:
      daysExpected === 0 ? null : round((daysPresent / daysExpected) * 100, 1),
    averageArrivalSeconds:
      arrivalWeight === 0 ? null : Math.round(arrivalTotal / arrivalWeight),
  };
}

function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/** Seconds after midnight as HH:mm, for display and for the CSV. */
export function formatArrival(seconds: number | null): string {
  if (seconds === null) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
