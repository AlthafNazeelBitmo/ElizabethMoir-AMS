import { formatNaiveLocal, parseNaiveLocal } from "../domain/time.js";

/**
 * Pulling usable scans out of a raw webhook body.
 *
 * Everything here treats the body as hostile input: it is unauthenticated,
 * comes from a third party, and the discovery run has not yet said what it
 * really looks like. Nothing is assumed about field spelling, value types,
 * or the shape of the envelope; anything unusable is reported with a reason
 * rather than dropped silently.
 */

export interface ExtractedScan {
  enrollNo: string;
  /** Exactly as transmitted, normalised only in formatting. */
  attTimeLocal: string;
  checkingStatus: string | null;
  verifyType: string | null;
  deviceSerial: string;
}

export interface ExtractionProblem {
  index: number;
  reason: string;
}

export interface ExtractionResult {
  scans: ExtractedScan[];
  problems: ExtractionProblem[];
}

/**
 * The verify-type key is spelled `VerifyType` in the vendor's sample JSON
 * and `VeryfyType` in their reference PHP. Rather than bet on one, both are
 * read — along with any other casing — so whichever they actually send is
 * captured. The discovery report still says which it was.
 */
const VERIFY_TYPE_PATTERN = /^ver[iy]f?y?type$/i;

/** Field lookup that tolerates any casing the vendor might use. */
function field(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (name in record) return record[name];
  }
  const lowered = new Map(Object.keys(record).map((k) => [k.toLowerCase(), k]));
  for (const name of names) {
    const actual = lowered.get(name.toLowerCase());
    if (actual !== undefined) return record[actual];
  }
  return undefined;
}

function scalar(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

export function extractScans(bodyJson: unknown): ExtractionResult {
  const scans: ExtractedScan[] = [];
  const problems: ExtractionProblem[] = [];

  // The documented envelope is a bare array. A single object, or an array
  // wrapped in a property, both appear in the wild often enough to accept.
  const items = toItems(bodyJson);
  if (items === null) {
    return {
      scans,
      problems: [{ index: -1, reason: "body is not an array of events" }],
    };
  }

  items.forEach((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      problems.push({ index, reason: "event is not an object" });
      return;
    }
    const record = item as Record<string, unknown>;

    const enrollNo = scalar(
      field(record, "EmpId", "empid", "EnrollNo", "enroll_no"),
    );
    const attTimeRaw = scalar(field(record, "AttTime", "atttime", "att_time"));
    const deviceSerial = scalar(
      field(record, "DeviceID", "deviceid", "device_id", "SN", "sn"),
    );

    if (enrollNo === null) {
      problems.push({ index, reason: "no EmpId" });
      return;
    }
    if (attTimeRaw === null) {
      problems.push({ index, reason: "no AttTime" });
      return;
    }
    if (deviceSerial === null) {
      problems.push({ index, reason: "no DeviceID" });
      return;
    }

    const naive = parseNaiveLocal(attTimeRaw);
    if (naive === null) {
      problems.push({
        index,
        reason: `AttTime "${attTimeRaw}" is not YYYY-MM-DD HH:mm:ss`,
      });
      return;
    }

    let verifyType: string | null = null;
    for (const [key, value] of Object.entries(record)) {
      if (VERIFY_TYPE_PATTERN.test(key)) {
        verifyType = scalar(value);
        break;
      }
    }

    scans.push({
      enrollNo,
      attTimeLocal: formatNaiveLocal(naive),
      checkingStatus: scalar(
        field(record, "CheckingStatus", "checkingstatus", "checking_status"),
      ),
      verifyType,
      deviceSerial,
    });
  });

  return { scans, problems };
}

function toItems(bodyJson: unknown): unknown[] | null {
  if (Array.isArray(bodyJson)) return bodyJson;
  if (typeof bodyJson === "object" && bodyJson !== null) {
    const record = bodyJson as Record<string, unknown>;
    for (const key of ["data", "events", "records", "Data", "Records"]) {
      const nested = record[key];
      if (Array.isArray(nested)) return nested;
    }
    // A single event posted bare.
    if ("EmpId" in record || "AttTime" in record) return [record];
  }
  return null;
}
