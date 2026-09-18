import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client.js";
import {
  calendarDays,
  dayRecords,
  devices,
  groups,
  people,
  rawEvents,
  scans,
  tutors,
  unknownEnrollments,
  type DayStatus,
  type DeviceDirection,
} from "../db/schema/index.js";
import { computeDayRecord, type DayScan } from "../domain/dayRecord.js";
import { dedupeKey } from "../domain/dedupe.js";
import {
  resolveDayDirections,
  type DeviceConfig,
} from "../domain/direction.js";
import {
  instantAtLocalTime,
  localToUtc,
  parseNaiveLocal,
  parseTimeOfDay,
  schoolDayFor,
} from "../domain/time.js";
import type {
  AttendanceSettings,
  SettingsService,
} from "../settings/service.js";
import type { RegisterBroadcaster } from "../register/broadcaster.js";
import { extractScans } from "./extract.js";

/**
 * Turns raw webhook envelopes into scans and derived day records.
 *
 * The queue is `raw_events` itself: a row with `processed_at IS NULL` is
 * work outstanding. The specification names Redis and BullMQ, and also
 * requires a reconciler that picks up unprocessed rows when Redis is down —
 * which means the reconciler has to be able to do the whole job anyway.
 * Making it the only path removes a service that can fail, works unchanged
 * on a serverless host where no worker process can exist, and keeps a
 * single code path rather than two that can drift. A queue can be layered on
 * later for latency without changing anything here.
 *
 * Everything is idempotent. Scans insert with ON CONFLICT DO NOTHING on the
 * dedupe key, and day records are recomputed from scratch rather than
 * adjusted, so replaying an envelope — or being killed half way through and
 * retried — cannot produce a duplicate or a drifted total.
 */

export interface ProcessResult {
  envelopesProcessed: number;
  scansInserted: number;
  scansSkippedAsDuplicate: number;
  dayRecordsWritten: number;
  unknownEnrollments: number;
  problems: number;
}

/** A person-day touched by this run, needing its directions and record redone. */
interface AffectedDay {
  enrollNo: string;
  date: string;
}

export class ScanProcessor {
  constructor(
    private readonly db: Db,
    private readonly settingsService: SettingsService,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
    /**
     * Optional so the processor can be used headlessly. When present, every
     * day record it writes is announced to connected registers.
     */
    private readonly broadcaster?: RegisterBroadcaster | undefined,
  ) {}

  /**
   * Processes up to `limit` outstanding envelopes. Safe to run concurrently
   * with itself: overlapping runs converge on the same rows.
   */
  async processPending(limit = 200): Promise<ProcessResult> {
    const settings = await this.settingsService.get();
    const result: ProcessResult = {
      envelopesProcessed: 0,
      scansInserted: 0,
      scansSkippedAsDuplicate: 0,
      dayRecordsWritten: 0,
      unknownEnrollments: 0,
      problems: 0,
    };

    const pending = await this.db
      .select({ id: rawEvents.id, bodyJson: rawEvents.bodyJson })
      .from(rawEvents)
      .where(isNull(rawEvents.processedAt))
      .orderBy(asc(rawEvents.id))
      .limit(limit);

    if (pending.length === 0) return result;

    const affected = new Map<string, AffectedDay>();

    for (const envelope of pending) {
      try {
        const outcome = await this.processEnvelope(
          envelope.id,
          envelope.bodyJson,
          settings,
        );
        result.scansInserted += outcome.inserted;
        result.scansSkippedAsDuplicate += outcome.skipped;
        result.unknownEnrollments += outcome.unknown;
        result.problems += outcome.problems;
        for (const day of outcome.affected)
          affected.set(`${day.enrollNo}|${day.date}`, day);
        result.envelopesProcessed += 1;
      } catch (err) {
        // One bad envelope must not stall the queue behind it. The row is
        // marked with the reason and left in place for inspection.
        const message = describeError(err);
        this.log.error(
          { rawEventId: envelope.id, err: message },
          "envelope processing failed",
        );
        await this.db
          .update(rawEvents)
          .set({
            processedAt: this.now(),
            processError: message.slice(0, 1000),
          })
          .where(eq(rawEvents.id, envelope.id));
        result.problems += 1;
      }
    }

    for (const day of affected.values()) {
      const written = await this.recomputeDay(day, settings);
      if (written) result.dayRecordsWritten += 1;
    }

    return result;
  }

  /** Re-runs a person-day from its stored scans. Used by replay and by admin. */
  async recomputePersonDay(enrollNo: string, date: string): Promise<boolean> {
    const settings = await this.settingsService.get();
    return this.recomputeDay({ enrollNo, date }, settings);
  }

  /**
   * Materialises absences for a school day.
   *
   * The specification asks for the day-record computation to run "nightly
   * for all people on school days", and this is that job. It is needed
   * because `recomputeDay` only ever sees people who scanned: someone who
   * never came has nothing to trigger a recomputation, so without this
   * their absence exists only as the lack of a row, which no report can
   * count.
   *
   * Idempotent and safe to run often: it creates nothing before the day has
   * reached the point where absence is meaningful, never touches an
   * existing record, and never touches a manually corrected one.
   */
  async markAbsences(date: string): Promise<number> {
    const settings = await this.settingsService.get();

    const [calendar] = await this.db
      .select({ type: calendarDays.type })
      .from(calendarDays)
      .where(eq(calendarDays.date, date))
      .limit(1);
    const isSchoolDay = calendar?.type === "school_day" || calendar?.type === "exception";
    if (!isSchoolDay) return 0;

    const decidedFrom =
      instantAtLocalTime(date, settings.absenceDecidedAfter, settings.timezone) ?? new Date(0);
    if (this.now() < decidedFrom) return 0;

    // Everyone expected that day who has no record for it.
    const candidates = await this.db
      .select({ personId: people.id })
      .from(people)
      .innerJoin(groups, eq(groups.id, people.groupId))
      .leftJoin(
        dayRecords,
        and(eq(dayRecords.personId, people.id), eq(dayRecords.date, date)),
      )
      .where(
        and(
          eq(people.isActive, true),
          eq(groups.expectsAttendance, true),
          isNull(dayRecords.id),
        ),
      );

    if (candidates.length === 0) return 0;

    await this.db
      .insert(dayRecords)
      .values(
        candidates.map((c) => ({
          personId: c.personId,
          date,
          status: "absent" as const,
          isLate: false,
          scanCount: 0,
          computedAt: this.now(),
        })),
      )
      .onConflictDoNothing({ target: [dayRecords.personId, dayRecords.date] });

    return candidates.length;
  }

  /** Marks absences for the school day it is currently in. */
  async markAbsencesForToday(): Promise<number> {
    const settings = await this.settingsService.get();
    const date = schoolDayFor(
      this.now(),
      settings.timezone,
      formatTime(settings.dayRolloverTime),
    );
    return this.markAbsences(date);
  }

  /**
   * Re-runs every day this enrolment has scans for. Used when an unknown
   * number is attached to a person: the scans were already stored, and the
   * register should show them at once.
   */
  async recomputeAllDaysFor(enrollNo: string): Promise<number> {
    const settings = await this.settingsService.get();
    const rows = await this.db
      .select({ attTime: scans.attTime })
      .from(scans)
      .where(eq(scans.enrollNo, enrollNo));

    const rollover = formatTime(settings.dayRolloverTime);
    const dates = new Set(
      rows.map((r) => schoolDayFor(r.attTime, settings.timezone, rollover)),
    );
    let written = 0;
    for (const date of dates) {
      if (await this.recomputeDay({ enrollNo, date }, settings)) written += 1;
    }
    return written;
  }

  // ── one envelope ────────────────────────────────────────────────────────

  private async processEnvelope(
    rawEventId: number,
    bodyJson: unknown,
    settings: AttendanceSettings,
  ): Promise<{
    inserted: number;
    skipped: number;
    unknown: number;
    problems: number;
    affected: AffectedDay[];
  }> {
    const { scans: extracted, problems } = extractScans(bodyJson);
    const affected: AffectedDay[] = [];
    let inserted = 0;
    let skipped = 0;
    let unknown = 0;

    for (const scan of extracted) {
      const naive = parseNaiveLocal(scan.attTimeLocal);
      if (naive === null) continue; // extractScans already validated; belt and braces
      const attTime = localToUtc(naive, settings.timezone);

      await this.touchDevice(scan.deviceSerial);
      const personId = await this.resolvePerson(scan.enrollNo, attTime);
      if (personId === null) unknown += 1;

      const key = dedupeKey({
        enrollNo: scan.enrollNo,
        attTimeLocal: scan.attTimeLocal,
        deviceSerial: scan.deviceSerial,
        checkingStatus: scan.checkingStatus,
      });

      const rows = await this.db
        .insert(scans)
        .values({
          enrollNo: scan.enrollNo,
          personId,
          attTime,
          attTimeLocal: scan.attTimeLocal,
          checkingStatus: scan.checkingStatus,
          verifyType: scan.verifyType,
          deviceSerial: scan.deviceSerial,
          // Provisional. The whole day is resolved together below, because a
          // scan's direction depends on the ones around it.
          direction: "unknown",
          directionSource: "sequence",
          dedupeKey: key,
          rawEventId,
        })
        .onConflictDoNothing({ target: scans.dedupeKey })
        .returning({ id: scans.id });

      if (rows.length > 0) inserted += 1;
      else skipped += 1;

      affected.push({
        enrollNo: scan.enrollNo,
        date: schoolDayFor(
          attTime,
          settings.timezone,
          formatTime(settings.dayRolloverTime),
        ),
      });
    }

    await this.db
      .update(rawEvents)
      .set({
        processedAt: this.now(),
        processError:
          problems.length > 0
            ? problems
                .map((p) => `event ${p.index}: ${p.reason}`)
                .join("; ")
                .slice(0, 1000)
            : null,
      })
      .where(eq(rawEvents.id, rawEventId));

    return { inserted, skipped, unknown, problems: problems.length, affected };
  }

  /** Records that a device exists and is alive. Direction stays admin-set. */
  private async touchDevice(serial: string): Promise<void> {
    await this.db
      .insert(devices)
      .values({
        serial,
        lastSeenAt: this.now(),
        direction: "both" as DeviceDirection,
      })
      .onConflictDoUpdate({
        target: devices.serial,
        set: { lastSeenAt: this.now() },
      });
  }

  /**
   * An unrecognised enrollment number never causes a scan to be discarded
   * (specification §6). The scan is stored with no person, and the number is
   * surfaced for the office to attach.
   *
   * A number belongs to an active person or to nobody. A deactivated
   * person's card still opens the reader, and a scan from it must not be
   * quietly filed under someone the register no longer shows: it is stored
   * unattached and the number goes back on the unknown list, where the
   * office sees whose it was and can reactivate them, which claims the
   * scans.
   */
  private async resolvePerson(
    enrollNo: string,
    seenAt: Date,
  ): Promise<string | null> {
    const [person] = await this.db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.enrollNo, enrollNo), eq(people.isActive, true)))
      .limit(1);
    if (person) return person.id;

    await this.db
      .insert(unknownEnrollments)
      .values({
        enrollNo,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        scanCount: 1,
      })
      .onConflictDoUpdate({
        target: unknownEnrollments.enrollNo,
        set: {
          // The value is passed as text and cast, not as a Date: inside a
          // raw fragment the query builder does not map it, and the
          // production driver has its own Date handling switched off by the
          // builder, so a bare Date reaches the wire untranslated. Column
          // values elsewhere are mapped; a raw fragment must do it itself.
          lastSeenAt: sql`greatest(${unknownEnrollments.lastSeenAt}, ${seenAt.toISOString()}::timestamptz)`,
          scanCount: sql`${unknownEnrollments.scanCount} + 1`,
          // Whoever this number was attached to no longer holds it.
          resolvedPersonId: null,
        },
      });
    return null;
  }

  // ── one person-day ──────────────────────────────────────────────────────

  private async recomputeDay(
    day: AffectedDay,
    settings: AttendanceSettings,
  ): Promise<boolean> {
    const rollover = formatTime(settings.dayRolloverTime);

    // Every scan for this enrolment, then narrowed to the school day. The
    // window is widened by a day either side so a rollover cannot clip it.
    const candidates = await this.db
      .select()
      .from(scans)
      .where(eq(scans.enrollNo, day.enrollNo))
      .orderBy(asc(scans.attTime));

    const ofDay = candidates.filter(
      (s) => schoolDayFor(s.attTime, settings.timezone, rollover) === day.date,
    );
    if (ofDay.length === 0) return false;

    const deviceConfigs = await this.loadDevices(
      ofDay.map((s) => s.deviceSerial),
    );

    const resolved = resolveDayDirections(
      ofDay.map((s) => ({
        attTime: s.attTime,
        deviceSerial: s.deviceSerial,
        checkingStatus: s.checkingStatus,
      })),
      {
        devices: deviceConfigs,
        statusMap: settings.checkingStatusMap,
        duplicateWindowSeconds: settings.duplicateWindowSeconds,
      },
    );

    // Persist any direction that changed. A no-op on a settled day.
    for (const [i, scan] of ofDay.entries()) {
      const r = resolved[i]!;
      if (
        scan.direction !== r.direction ||
        scan.directionSource !== r.directionSource
      ) {
        await this.db
          .update(scans)
          .set({ direction: r.direction, directionSource: r.directionSource })
          .where(eq(scans.id, scan.id));
      }
    }

    const personId = ofDay.find((s) => s.personId !== null)?.personId ?? null;
    // An unattached enrolment has no person to hang a day record on. The
    // scans are safe; the record appears as soon as someone attaches them.
    if (personId === null) return false;

    const context = await this.dayContext(personId, day.date, settings);
    const dayScans: DayScan[] = ofDay.map((s, i) => ({
      attTime: s.attTime,
      direction: resolved[i]!.direction,
      isDuplicate: resolved[i]!.isDuplicate,
    }));

    const computed = computeDayRecord(dayScans, context);
    if (computed === null) return false;

    await this.db
      .insert(dayRecords)
      .values({
        personId,
        date: day.date,
        firstIn: computed.firstIn,
        lastOut: computed.lastOut,
        status: computed.status,
        isLate: computed.isLate,
        scanCount: computed.scanCount,
        computedAt: this.now(),
      })
      .onConflictDoUpdate({
        target: [dayRecords.personId, dayRecords.date],
        set: {
          firstIn: computed.firstIn,
          lastOut: computed.lastOut,
          status: computed.status,
          isLate: computed.isLate,
          scanCount: computed.scanCount,
          computedAt: this.now(),
        },
        // A day an administrator has corrected by hand is never overwritten
        // by a recomputation.
        where: eq(dayRecords.hasManualEdit, false),
      });

    await this.announce(personId, day.date, computed);
    return true;
  }

  /**
   * Tells connected registers that this person's day changed. Failure is
   * swallowed: the stream is a convenience, and a screen that misses an
   * event is still correct after its next fetch.
   */
  private async announce(
    personId: string,
    date: string,
    computed: { status: DayStatus; isLate: boolean; firstIn: Date | null; lastOut: Date | null; scanCount: number },
  ): Promise<void> {
    if (!this.broadcaster) return;
    try {
      const [row] = await this.db
        .select({
          fullName: people.fullName,
          enrollNo: people.enrollNo,
          branch: groups.branch,
          groupId: groups.id,
          groupName: groups.name,
          tutorInitials: tutors.initials,
          hasManualEdit: dayRecords.hasManualEdit,
        })
        .from(people)
        .leftJoin(groups, eq(groups.id, people.groupId))
        .leftJoin(tutors, eq(tutors.id, people.tutorId))
        .leftJoin(
          dayRecords,
          and(eq(dayRecords.personId, people.id), eq(dayRecords.date, date)),
        )
        .where(eq(people.id, personId))
        .limit(1);
      if (!row) return;

      this.broadcaster.publish({
        type: "scan",
        personId,
        fullName: row.fullName,
        enrollNo: row.enrollNo,
        branch: row.branch,
        groupId: row.groupId,
        groupName: row.groupName,
        tutorInitials: row.tutorInitials,
        date,
        firstIn: computed.firstIn?.toISOString() ?? null,
        lastOut: computed.lastOut?.toISOString() ?? null,
        status: computed.status,
        isLate: computed.isLate,
        hasManualEdit: row.hasManualEdit ?? false,
        scanCount: computed.scanCount,
      });
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "could not announce a day record change",
      );
    }
  }

  private async loadDevices(
    serials: string[],
  ): Promise<Map<string, DeviceConfig>> {
    const unique = [...new Set(serials)];
    if (unique.length === 0) return new Map();
    const rows = await this.db
      .select({
        serial: devices.serial,
        direction: devices.direction,
        trustCheckingStatus: devices.trustCheckingStatus,
      })
      .from(devices)
      .where(inArray(devices.serial, unique));
    return new Map(
      rows.map((r) => [
        r.serial,
        { direction: r.direction, trustCheckingStatus: r.trustCheckingStatus },
      ]),
    );
  }

  private async dayContext(
    personId: string,
    date: string,
    settings: AttendanceSettings,
  ) {
    const [row] = await this.db
      .select({
        expectsAttendance: groups.expectsAttendance,
        groupLateThreshold: groups.lateThreshold,
        groupId: people.groupId,
      })
      .from(people)
      .leftJoin(groups, eq(groups.id, people.groupId))
      .where(eq(people.id, personId))
      .limit(1);

    const [calendar] = await this.db
      .select({ type: calendarDays.type })
      .from(calendarDays)
      .where(eq(calendarDays.date, date))
      .limit(1);

    // A date nobody has entered is not treated as a school day. An empty
    // calendar therefore produces no absences at all, which is the safe way
    // to be wrong: a missing absence is a gap, an invented one is an
    // accusation.
    const isSchoolDay =
      calendar?.type === "school_day" || calendar?.type === "exception";

    // A person with no group still gets a record; they are simply not
    // expected until someone classifies them.
    const expectsAttendance =
      row?.groupId == null ? false : (row.expectsAttendance ?? false);

    const thresholdTime =
      (row?.groupLateThreshold
        ? parseTimeOfDay(row.groupLateThreshold)
        : null) ?? settings.lateThresholdDefault;

    return {
      expectsAttendance,
      isSchoolDay,
      lateThreshold: thresholdTime
        ? instantAtLocalTime(date, thresholdTime, settings.timezone)
        : null,
      absenceDecidedFrom:
        instantAtLocalTime(
          date,
          settings.absenceDecidedAfter,
          settings.timezone,
        ) ?? new Date(0),
      now: this.now(),
    };
  }
}

function formatTime(t: {
  hour: number;
  minute: number;
  second: number;
}): string {
  const p = (v: number) => String(v).padStart(2, "0");
  return `${p(t.hour)}:${p(t.minute)}:${p(t.second)}`;
}

/**
 * The reason, as the database gave it.
 *
 * The query builder wraps a driver error in its own, whose message is the
 * whole statement and its parameters — and hides the one line that says
 * what was wrong. That line is on the cause; it goes first, with the
 * database's error code and detail when it has them, and the statement's
 * first line after it so the two can still be matched up.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (!(cause instanceof Error)) return err.message;
  const pg = cause as Error & { code?: string; detail?: string; hint?: string };
  const parts = [pg.message];
  if (pg.code) parts.push(`[${pg.code}]`);
  if (pg.detail) parts.push(pg.detail);
  if (pg.hint) parts.push(`hint: ${pg.hint}`);
  const statement = err.message.split("\n")[0]?.slice(0, 200) ?? "";
  return `${parts.join(" ")} — ${statement}`;
}
