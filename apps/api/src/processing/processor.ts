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
  unknownEnrollments,
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
        const message = err instanceof Error ? err.message : String(err);
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
   */
  private async resolvePerson(
    enrollNo: string,
    seenAt: Date,
  ): Promise<string | null> {
    const [person] = await this.db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.enrollNo, enrollNo))
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
          lastSeenAt: sql`greatest(${unknownEnrollments.lastSeenAt}, ${seenAt})`,
          scanCount: sql`${unknownEnrollments.scanCount} + 1`,
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

    return true;
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
