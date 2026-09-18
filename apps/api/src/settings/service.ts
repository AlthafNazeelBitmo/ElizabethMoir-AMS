import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { settings } from "../db/schema/index.js";
import { parseStatusMap } from "../domain/direction.js";
import type { Direction } from "../db/schema/index.js";
import {
  isValidTimeZone,
  parseTimeOfDay,
  type TimeOfDay,
} from "../domain/time.js";

/**
 * Operational rules, read from the database and never hardcoded
 * (specification §8).
 *
 * Every one of these has a code default, so a fresh database works before
 * anyone has configured anything, and a row that is missing or has been
 * filled with nonsense falls back rather than crashing the processor. The
 * defaults are starting points, not truths — in particular `timezone` and
 * `checking_status_map` encode facts about the feed that only the discovery
 * run can actually establish.
 */
export interface AttendanceSettings {
  /** Printed on reports and shown in the title bar. */
  schoolName: string;
  timezone: string;
  lateThresholdDefault: TimeOfDay | null;
  duplicateWindowSeconds: number;
  dayRolloverTime: TimeOfDay;
  /** What each CheckingStatus value means. Empty until proven. */
  checkingStatusMap: Record<string, Direction>;
  /** Time of day from which an absence may be declared. */
  absenceDecidedAfter: TimeOfDay;
}

export const SETTING_KEYS = {
  schoolName: "school_name",
  timezone: "timezone",
  lateThresholdDefault: "late_threshold_default",
  duplicateWindowSeconds: "duplicate_window_seconds",
  dayRolloverTime: "day_rollover_time",
  checkingStatusMap: "checking_status_map",
  absenceDecidedAfter: "absence_decided_after",
} as const;

/** The longest a school name may be. Long enough for any real one. */
export const SCHOOL_NAME_MAX_LENGTH = 100;

export const DEFAULT_SETTINGS: AttendanceSettings = {
  // Deliberately generic: the name is set by the school in Admin → Rules,
  // and a report printed before that says so rather than guessing.
  schoolName: "School",
  // Provisional: the reader's transaction times read as Sri Lanka local
  // time. Must be confirmed against the discovery report.
  timezone: "Asia/Colombo",
  lateThresholdDefault: { hour: 8, minute: 0, second: 0 },
  duplicateWindowSeconds: 60,
  dayRolloverTime: { hour: 3, minute: 0, second: 0 },
  // Deliberately empty: nothing is known about what 0 and 1 mean, and an
  // invented mapping would produce confident, wrong arrival times.
  checkingStatusMap: {},
  // An hour after the default late threshold, so latecomers are not reported
  // missing while they are still on their way.
  absenceDecidedAfter: { hour: 9, minute: 0, second: 0 },
};

export class SettingsService {
  private cache: { value: AttendanceSettings; loadedAt: number } | null = null;

  constructor(
    private readonly db: Db,
    /** How long a read is reused. Short: an admin edit should take effect promptly. */
    private readonly ttlMs = 30_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  invalidate(): void {
    this.cache = null;
  }

  async get(): Promise<AttendanceSettings> {
    const cached = this.cache;
    if (cached && this.now() - cached.loadedAt < this.ttlMs)
      return cached.value;

    const rows = await this.db
      .select()
      .from(settings)
      .where(inArray(settings.key, Object.values(SETTING_KEYS)));

    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const value = coerce(byKey);
    this.cache = { value, loadedAt: this.now() };
    return value;
  }

  /** Writes one setting and drops the cache. Validation is the caller's job. */
  async set(
    key: string,
    value: unknown,
    updatedBy: string | null,
  ): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value, updatedBy, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedBy, updatedAt: new Date() },
      });
    this.invalidate();
  }

  /** Removes a setting so the default applies again. */
  async unset(key: string): Promise<void> {
    await this.db.delete(settings).where(eq(settings.key, key));
    this.invalidate();
  }

  async getRaw(key: string): Promise<unknown> {
    const [row] = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    return row?.value;
  }
}

/** Turns stored JSON into settings, falling back per field rather than wholesale. */
export function coerce(byKey: Map<string, unknown>): AttendanceSettings {
  return {
    schoolName:
      asSchoolName(byKey.get(SETTING_KEYS.schoolName)) ??
      DEFAULT_SETTINGS.schoolName,
    timezone:
      asTimeZone(byKey.get(SETTING_KEYS.timezone)) ?? DEFAULT_SETTINGS.timezone,
    lateThresholdDefault:
      asTimeOfDay(byKey.get(SETTING_KEYS.lateThresholdDefault)) ??
      DEFAULT_SETTINGS.lateThresholdDefault,
    duplicateWindowSeconds:
      asPositiveInt(byKey.get(SETTING_KEYS.duplicateWindowSeconds)) ??
      DEFAULT_SETTINGS.duplicateWindowSeconds,
    dayRolloverTime:
      asTimeOfDay(byKey.get(SETTING_KEYS.dayRolloverTime)) ??
      DEFAULT_SETTINGS.dayRolloverTime,
    checkingStatusMap: parseStatusMap(
      byKey.get(SETTING_KEYS.checkingStatusMap),
    ),
    absenceDecidedAfter:
      asTimeOfDay(byKey.get(SETTING_KEYS.absenceDecidedAfter)) ??
      DEFAULT_SETTINGS.absenceDecidedAfter,
  };
}

/** A non-empty string within the limit, trimmed; anything else is refused. */
export function asSchoolName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 && trimmed.length <= SCHOOL_NAME_MAX_LENGTH
    ? trimmed
    : null;
}

function asTimeZone(v: unknown): string | null {
  return typeof v === "string" && isValidTimeZone(v) ? v : null;
}

function asTimeOfDay(v: unknown): TimeOfDay | null {
  return typeof v === "string" ? parseTimeOfDay(v) : null;
}

function asPositiveInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}
