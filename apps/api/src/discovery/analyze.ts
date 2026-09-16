import { ATT_TIME_PATTERN } from "@ams/shared";

/**
 * Phase 0 analysis: answers every "known unknown" in spec §1 from the rows in
 * `raw_events`. Pure — no I/O, no clock — so it is unit-testable and can be
 * re-run against the same rows to reproduce a report exactly.
 */

export interface RawEventInput {
  id: number;
  receivedAt: Date;
  remoteIp: string | null;
  method: string | null;
  headers: Record<string, string | string[] | undefined> | null;
  contentType: string | null;
  bodyBytes: number | null;
  bodyJson: unknown;
  batchSize: number | null;
  parseError: string | null;
}

export interface Count<T = string> {
  value: T;
  count: number;
}

export interface Percentiles {
  samples: number;
  min: number;
  p10: number;
  median: number;
  p90: number;
  max: number;
}

export type PerDayBucket = "1" | "2" | "3" | "4+";

export interface DeviceStatusProfile {
  device: string;
  events: number;
  statusValues: Count[];
  /** Consecutive same-person scan pairs on this device, ordered by AttTime. */
  personPairs: number;
  /** Of those pairs, how many changed CheckingStatus. */
  pairsWithDifferentStatus: number;
  /** Pairs with identical AttTime but different status: the vendor-sample artefact. */
  sameSecondDifferentStatus: number;
  /** Histogram of scans per (EmpId, transmitted date). */
  scansPerPersonPerDay: Count<PerDayBucket>[];
  verdict: string;
}

export interface HeaderProfile {
  name: string;
  count: number;
  examples: string[];
  looksLikeToken: boolean;
}

export interface DiscoveryReport {
  window: { firstReceivedAt: string | null; lastReceivedAt: string | null };
  totals: {
    deliveries: number;
    deliveriesParsedAsArray: number;
    deliveriesWithParseError: number;
    deliveriesOversize: number;
    events: number;
    nonObjectEvents: number;
    distinctEmpIds: number;
    distinctDevices: number;
  };
  keys: Array<Count & { pctOfEvents: number }>;
  verifyType: { keyCandidates: Count[]; values: Count[]; verdict: string };
  checkingStatusByDevice: DeviceStatusProfile[];
  attTime: {
    format: {
      matchingPattern: number;
      notMatching: number;
      examplesNotMatching: string[];
    };
    offsetMinutes: Percentiles | null;
    offsetHistogram: Count<number>[];
    hourOfDayHistogram: Count<number>[];
    verdict: string;
  };
  batches: { sizes: Percentiles | null; histogram: Count<number>[] };
  interArrivalSeconds: { stats: Percentiles | null; histogram: Count[] };
  redelivery: {
    tuplesSeenMoreThanOnce: number;
    eventsInRepeatedTuples: number;
    exactRepeatsIncludingStatus: number;
    repeatsAcrossDeliveries: number;
    repeatsWithinOneDelivery: number;
    verdict: string;
  };
  sourceIps: Count[];
  methods: Count[];
  contentTypes: Count[];
  headers: HeaderProfile[];
  parseErrors: Count[];
  devices: Array<{
    serial: string;
    events: number;
    distinctEmpIds: number;
    firstAttTime: string | null;
    lastAttTime: string | null;
  }>;
  empIdDeviceOverlap: {
    empIdsOnMultipleDevices: number;
    examples: Array<{ empId: string; devices: string[] }>;
  };
  outOfOrderDeliveries: number;
}

/** One event flattened for analysis. Field access is case-exact by design. */
interface FlatEvent {
  deliveryId: number;
  receivedAt: Date;
  indexInBatch: number;
  raw: Record<string, unknown>;
  empId: string | null;
  attTime: string | null;
  attTimeUtcMs: number | null;
  checkingStatus: string | null;
  device: string | null;
}

const TOKEN_HEADER_NAME =
  /auth|token|key|secret|sign|hmac|x-api|x-hub|x-adms|x-webhook|x-vft|credential/i;
const TOKEN_VALUE = /^[A-Za-z0-9+/_\-=.]{20,}$/;
const PLAIN_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "user-agent",
  "accept",
  "accept-encoding",
  "connection",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-real-ip",
  "via",
  "cache-control",
  "pragma",
  "expect",
  "transfer-encoding",
  "accept-language",
  "accept-charset",
  "date",
  "origin",
  "referer",
]);

export function analyze(rows: readonly RawEventInput[]): DiscoveryReport {
  const sorted = [...rows].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id - b.id,
  );
  const events = flatten(sorted);

  return {
    window: {
      firstReceivedAt: sorted[0]?.receivedAt.toISOString() ?? null,
      lastReceivedAt: sorted.at(-1)?.receivedAt.toISOString() ?? null,
    },
    totals: totals(sorted, events),
    keys: keyCounts(events),
    verifyType: verifyType(events),
    checkingStatusByDevice: checkingStatusByDevice(events),
    attTime: attTime(events),
    batches: batches(sorted),
    interArrivalSeconds: interArrival(sorted),
    redelivery: redelivery(events),
    sourceIps: countBy(sorted, (r) => r.remoteIp ?? "(none)"),
    methods: countBy(sorted, (r) => r.method ?? "(none)"),
    contentTypes: countBy(sorted, (r) => r.contentType ?? "(none)"),
    headers: headerProfiles(sorted),
    parseErrors: countBy(
      sorted.filter((r) => r.parseError),
      (r) => r.parseError ?? "",
    ),
    devices: devices(events),
    empIdDeviceOverlap: empIdDeviceOverlap(events),
    outOfOrderDeliveries: outOfOrder(events),
  };
}

// ── Flattening ─────────────────────────────────────────────────────────────

function flatten(rows: readonly RawEventInput[]): FlatEvent[] {
  const out: FlatEvent[] = [];
  for (const row of rows) {
    if (!Array.isArray(row.bodyJson)) continue;
    row.bodyJson.forEach((item: unknown, i) => {
      const raw = isRecord(item) ? item : {};
      const attTime = stringOrNull(raw["AttTime"]);
      out.push({
        deliveryId: row.id,
        receivedAt: row.receivedAt,
        indexInBatch: i,
        raw: isRecord(item) ? item : { __nonObject: item },
        empId: stringOrNull(raw["EmpId"]),
        attTime,
        attTimeUtcMs: attTime === null ? null : parseAttTimeAsUtc(attTime),
        checkingStatus: stringOrNull(raw["CheckingStatus"]),
        device: stringOrNull(raw["DeviceID"]),
      });
    });
  }
  return out;
}

/** Interpret the vendor's naive `YYYY-MM-DD HH:mm:ss` as if it were UTC. */
export function parseAttTimeAsUtc(s: string): number | null {
  const m = ATT_TIME_PATTERN.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(se),
  );
  return Number.isNaN(ms) ? null : ms;
}

// ── Sections ───────────────────────────────────────────────────────────────

function totals(
  rows: readonly RawEventInput[],
  events: FlatEvent[],
): DiscoveryReport["totals"] {
  return {
    deliveries: rows.length,
    deliveriesParsedAsArray: rows.filter((r) => Array.isArray(r.bodyJson))
      .length,
    deliveriesWithParseError: rows.filter((r) => r.parseError !== null).length,
    deliveriesOversize: rows.filter((r) =>
      /exceeded .* cap/.test(r.parseError ?? ""),
    ).length,
    events: events.length,
    nonObjectEvents: events.filter((e) => "__nonObject" in e.raw).length,
    distinctEmpIds: new Set(
      events.map((e) => e.empId).filter((v): v is string => v !== null),
    ).size,
    distinctDevices: new Set(
      events.map((e) => e.device).filter((v): v is string => v !== null),
    ).size,
  };
}

function keyCounts(events: FlatEvent[]): DiscoveryReport["keys"] {
  const counts = new Map<string, number>();
  for (const e of events) {
    for (const k of Object.keys(e.raw)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({
      value,
      count,
      pctOfEvents: events.length ? round((count / events.length) * 100, 1) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function verifyType(events: FlatEvent[]): DiscoveryReport["verifyType"] {
  const keyCandidates = new Map<string, number>();
  const values = new Map<string, number>();
  for (const e of events) {
    for (const [k, v] of Object.entries(e.raw)) {
      if (/ver.?[iy].?f.?y.?type/i.test(k) || /^verify/i.test(k)) {
        keyCandidates.set(k, (keyCandidates.get(k) ?? 0) + 1);
        const sv = stringOrNull(v) ?? "(null)";
        values.set(sv, (values.get(sv) ?? 0) + 1);
      }
    }
  }
  const candidates = toCounts(keyCandidates);
  let verdict: string;
  if (candidates.length === 0) verdict = "No verify-type key observed at all.";
  else if (candidates.length === 1)
    verdict = `The key is spelled exactly "${candidates[0]!.value}" on every event that has one.`;
  else
    verdict = `Multiple spellings observed: ${candidates.map((c) => `"${c.value}" x${c.count}`).join(", ")}. Read all of them.`;
  return { keyCandidates: candidates, values: toCounts(values), verdict };
}

function checkingStatusByDevice(events: FlatEvent[]): DeviceStatusProfile[] {
  const byDevice = groupBy(events, (e) => e.device ?? "(none)");
  return [...byDevice]
    .map(([device, evs]) => {
      const statusValues = countBy(evs, (e) => e.checkingStatus ?? "(null)");

      let personPairs = 0;
      let pairsWithDifferentStatus = 0;
      let sameSecondDifferentStatus = 0;
      const perPersonDay = new Map<string, number>();
      for (const [empId, personEvents] of groupBy(evs, (e) => e.empId ?? "(none)")) {
        const ordered = [...personEvents].sort(
          (a, b) =>
            (a.attTimeUtcMs ?? 0) - (b.attTimeUtcMs ?? 0) ||
            a.deliveryId - b.deliveryId ||
            a.indexInBatch - b.indexInBatch,
        );
        for (let i = 1; i < ordered.length; i++) {
          const prev = ordered[i - 1]!;
          const cur = ordered[i]!;
          personPairs += 1;
          if (prev.checkingStatus !== cur.checkingStatus) {
            pairsWithDifferentStatus += 1;
            if (prev.attTime === cur.attTime) sameSecondDifferentStatus += 1;
          }
        }
        for (const ev of ordered) {
          const key = `${empId}|${ev.attTime?.slice(0, 10) ?? "?"}`;
          perPersonDay.set(key, (perPersonDay.get(key) ?? 0) + 1);
        }
      }
      const buckets: Record<PerDayBucket, number> = {
        "1": 0,
        "2": 0,
        "3": 0,
        "4+": 0,
      };
      for (const n of perPersonDay.values())
        buckets[n >= 4 ? "4+" : (String(n) as PerDayBucket)] += 1;

      let verdict: string;
      if (statusValues.length <= 1) {
        verdict =
          "Emits a single CheckingStatus value: the flag carries no direction information on this device.";
      } else if (
        personPairs > 0 &&
        sameSecondDifferentStatus / Math.max(1, pairsWithDifferentStatus) > 0.5
      ) {
        verdict =
          "Status differs mainly within the same second for the same person: looks like the vendor artefact (one tap, two rows), not direction.";
      } else if (
        personPairs > 0 &&
        pairsWithDifferentStatus / personPairs > 0.7
      ) {
        verdict =
          "Status alternates between a person's consecutive scans: the flag is plausibly a real in/out indicator here.";
      } else {
        verdict =
          "Mixed: status changes sometimes but not consistently. Do not trust it without a manual check against the gate.";
      }

      return {
        device,
        events: evs.length,
        statusValues,
        personPairs,
        pairsWithDifferentStatus,
        sameSecondDifferentStatus,
        scansPerPersonPerDay: (["1", "2", "3", "4+"] as const).map((k) => ({
          value: k,
          count: buckets[k],
        })),
        verdict,
      };
    })
    .sort((a, b) => b.events - a.events);
}

function attTime(events: FlatEvent[]): DiscoveryReport["attTime"] {
  const notMatching = events.filter(
    (e) => e.attTime !== null && e.attTimeUtcMs === null,
  );
  const offsets: number[] = [];
  const hourCounts = new Map<number, number>();
  for (const e of events) {
    if (e.attTimeUtcMs === null || e.attTime === null) continue;
    offsets.push((e.attTimeUtcMs - e.receivedAt.getTime()) / 60_000);
    const hour = Number(e.attTime.slice(11, 13));
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  const stats = percentiles(offsets);
  const histogram = histogramOf(offsets.map((m) => Math.round(m / 15) * 15));
  const hourOfDayHistogram = Array.from({ length: 24 }, (_, h) => ({
    value: h,
    count: hourCounts.get(h) ?? 0,
  }));

  let verdict: string;
  if (stats === null) {
    verdict = "No parseable AttTime values yet.";
  } else {
    const nearestQuarter = Math.round(stats.median / 15) * 15;
    const lag = round(nearestQuarter - stats.median, 1);
    const spread = round(stats.p90 - stats.p10, 1);
    const offsetLabel = formatOffset(nearestQuarter);
    if (nearestQuarter === 0) {
      verdict = `Median AttTime minus received is ${round(stats.median, 1)} min: AttTime is UTC (delivery lag about ${lag} min, p10-p90 spread ${spread} min).`;
    } else if (nearestQuarter === 330) {
      verdict = `Median AttTime minus received is ${round(stats.median, 1)} min, i.e. +5:30: AttTime is local Sri Lanka time (Asia/Colombo) transmitted without an offset. Delivery lag about ${lag} min, p10-p90 spread ${spread} min.`;
    } else {
      verdict = `Median AttTime minus received is ${round(stats.median, 1)} min, i.e. ${offsetLabel}: AttTime is local time in a ${offsetLabel} zone. Delivery lag about ${lag} min, p10-p90 spread ${spread} min. Check the device clock.`;
    }
  }

  return {
    format: {
      matchingPattern: events.filter((e) => e.attTimeUtcMs !== null).length,
      notMatching: notMatching.length,
      examplesNotMatching: uniq(notMatching.map((e) => e.attTime ?? "")).slice(
        0,
        5,
      ),
    },
    offsetMinutes: stats,
    offsetHistogram: histogram,
    hourOfDayHistogram,
    verdict,
  };
}

function batches(rows: readonly RawEventInput[]): DiscoveryReport["batches"] {
  const sizes = rows
    .map((r) => r.batchSize)
    .filter((n): n is number => n !== null);
  return { sizes: percentiles(sizes), histogram: histogramOf(sizes) };
}

const GAP_BUCKETS = [
  "<1s",
  "1-10s",
  "10-60s",
  "1-5min",
  "5-15min",
  "15-60min",
  ">1h",
] as const;

function interArrival(
  rows: readonly RawEventInput[],
): DiscoveryReport["interArrivalSeconds"] {
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    gaps.push(
      (rows[i]!.receivedAt.getTime() - rows[i - 1]!.receivedAt.getTime()) /
        1000,
    );
  }
  const bucketOf = (g: number): string =>
    g < 1
      ? "<1s"
      : g < 10
        ? "1-10s"
        : g < 60
          ? "10-60s"
          : g < 300
            ? "1-5min"
            : g < 900
              ? "5-15min"
              : g < 3600
                ? "15-60min"
                : ">1h";
  const histogram = countBy(gaps.map(bucketOf), (b) => b).sort(
    (a, b) =>
      GAP_BUCKETS.indexOf(a.value as (typeof GAP_BUCKETS)[number]) -
      GAP_BUCKETS.indexOf(b.value as (typeof GAP_BUCKETS)[number]),
  );
  return { stats: percentiles(gaps), histogram };
}

function redelivery(events: FlatEvent[]): DiscoveryReport["redelivery"] {
  const byTuple = groupBy(events, (e) => `${e.empId}|${e.attTime}|${e.device}`);
  const byTupleWithStatus = groupBy(
    events,
    (e) => `${e.empId}|${e.attTime}|${e.device}|${e.checkingStatus}`,
  );

  let tuplesSeenMoreThanOnce = 0;
  let eventsInRepeatedTuples = 0;
  for (const [, evs] of byTuple) {
    if (evs.length > 1) {
      tuplesSeenMoreThanOnce += 1;
      eventsInRepeatedTuples += evs.length;
    }
  }

  let exactRepeatsIncludingStatus = 0;
  let repeatsAcrossDeliveries = 0;
  let repeatsWithinOneDelivery = 0;
  for (const [, evs] of byTupleWithStatus) {
    if (evs.length <= 1) continue;
    exactRepeatsIncludingStatus += evs.length - 1;
    const deliveries = new Set(evs.map((e) => e.deliveryId));
    if (deliveries.size > 1) repeatsAcrossDeliveries += evs.length - 1;
    else repeatsWithinOneDelivery += evs.length - 1;
  }

  let verdict: string;
  if (tuplesSeenMoreThanOnce === 0) {
    verdict =
      "No repeated (EmpId, AttTime, DeviceID) tuples: no redelivery observed.";
  } else if (exactRepeatsIncludingStatus === 0) {
    verdict =
      "Repeated tuples always differ in CheckingStatus: this is the vendor's two-rows-per-tap artefact, not redelivery. Including status in the dedupe key is correct.";
  } else if (repeatsAcrossDeliveries > 0) {
    verdict = `${repeatsAcrossDeliveries} exact repeats arrived in separate deliveries: the platform redelivers. Dedupe on the full key is mandatory.`;
  } else {
    verdict = `${repeatsWithinOneDelivery} exact repeats within single deliveries: batches themselves contain duplicates.`;
  }

  return {
    tuplesSeenMoreThanOnce,
    eventsInRepeatedTuples,
    exactRepeatsIncludingStatus,
    repeatsAcrossDeliveries,
    repeatsWithinOneDelivery,
    verdict,
  };
}

function headerProfiles(rows: readonly RawEventInput[]): HeaderProfile[] {
  const byName = new Map<
    string,
    { count: number; examples: Set<string>; token: boolean }
  >();
  for (const row of rows) {
    for (const [rawName, rawValue] of Object.entries(row.headers ?? {})) {
      const name = rawName.toLowerCase();
      const value = Array.isArray(rawValue)
        ? rawValue.join(", ")
        : (rawValue ?? "");
      const entry = byName.get(name) ?? {
        count: 0,
        examples: new Set<string>(),
        token: false,
      };
      entry.count += 1;
      if (entry.examples.size < 3) entry.examples.add(truncate(value, 120));
      if (
        !PLAIN_HEADERS.has(name) &&
        (TOKEN_HEADER_NAME.test(name) || TOKEN_VALUE.test(value))
      )
        entry.token = true;
      byName.set(name, entry);
    }
  }
  return [...byName]
    .map(([name, e]) => ({
      name,
      count: e.count,
      examples: [...e.examples],
      looksLikeToken: e.token,
    }))
    .sort(
      (a, b) =>
        Number(b.looksLikeToken) - Number(a.looksLikeToken) ||
        b.count - a.count ||
        a.name.localeCompare(b.name),
    );
}

function devices(events: FlatEvent[]): DiscoveryReport["devices"] {
  return [...groupBy(events, (e) => e.device ?? "(none)")]
    .map(([serial, evs]) => {
      const times = evs
        .map((e) => e.attTime)
        .filter((t): t is string => t !== null)
        .sort();
      return {
        serial,
        events: evs.length,
        distinctEmpIds: new Set(evs.map((e) => e.empId)).size,
        firstAttTime: times[0] ?? null,
        lastAttTime: times.at(-1) ?? null,
      };
    })
    .sort((a, b) => b.events - a.events);
}

function empIdDeviceOverlap(
  events: FlatEvent[],
): DiscoveryReport["empIdDeviceOverlap"] {
  const devicesByEmp = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.empId === null || e.device === null) continue;
    const set = devicesByEmp.get(e.empId) ?? new Set<string>();
    set.add(e.device);
    devicesByEmp.set(e.empId, set);
  }
  const multi = [...devicesByEmp].filter(([, d]) => d.size > 1);
  return {
    empIdsOnMultipleDevices: multi.length,
    examples: multi
      .slice(0, 10)
      .map(([empId, d]) => ({ empId, devices: [...d].sort() })),
  };
}

/** Deliveries whose events are not in non-decreasing AttTime order. */
function outOfOrder(events: FlatEvent[]): number {
  let count = 0;
  for (const [, evs] of groupBy(events, (e) => String(e.deliveryId))) {
    const ordered = [...evs].sort((a, b) => a.indexInBatch - b.indexInBatch);
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1]!.attTimeUtcMs;
      const b = ordered[i]!.attTimeUtcMs;
      if (a !== null && b !== null && b < a) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function groupBy<T>(
  items: readonly T[],
  key: (t: T) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = out.get(k);
    if (arr) arr.push(it);
    else out.set(k, [it]);
  }
  return out;
}

function countBy<T>(items: readonly T[], key: (t: T) => string): Count[] {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return toCounts(m);
}

function toCounts(m: Map<string, number>): Count[] {
  return [...m]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function histogramOf(values: readonly number[]): Count<number>[] {
  const m = new Map<number, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value - b.value);
}

export function percentiles(values: readonly number[]): Percentiles | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]!;
  return {
    samples: s.length,
    min: round(s[0]!, 2),
    p10: round(at(0.1), 2),
    median: round(at(0.5), 2),
    p90: round(at(0.9), 2),
    max: round(s[s.length - 1]!, 2),
  };
}

function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}...`;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}
