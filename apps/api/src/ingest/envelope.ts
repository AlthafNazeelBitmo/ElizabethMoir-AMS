import type { NewRawEvent } from "../db/schema.js";

/**
 * The persisted form of one webhook delivery. Built by the ingest handler,
 * written to `raw_events`, or spooled to disk verbatim when the database is
 * unreachable. Dates are ISO strings so the envelope round-trips through JSON.
 */
export interface Envelope {
  receivedAt: string;
  remoteIp: string | null;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  contentType: string | null;
  bodyBytes: number | null;
  bodyText: string | null;
  bodyJson: unknown;
  batchSize: number | null;
  parseError: string | null;
}

export function envelopeToRow(e: Envelope): NewRawEvent {
  return {
    receivedAt: new Date(e.receivedAt),
    remoteIp: e.remoteIp,
    method: e.method,
    headers: e.headers,
    contentType: e.contentType,
    bodyBytes: e.bodyBytes,
    bodyText: e.bodyText,
    bodyJson: e.bodyJson,
    batchSize: e.batchSize,
    parseError: e.parseError,
  };
}

/**
 * Parse the raw body the way the vendor's reference does — `json_decode` on
 * whatever arrived — but record exactly what went wrong when it does not.
 * Never throws.
 */
export function parseBody(bodyText: string): Pick<Envelope, "bodyJson" | "batchSize" | "parseError"> {
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) {
    return { bodyJson: null, batchSize: null, parseError: "empty body" };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return { bodyJson: parsed, batchSize: parsed.length, parseError: null };
    }
    return {
      bodyJson: parsed,
      batchSize: null,
      parseError: `JSON parsed but top level is ${describeJsonType(parsed)}, not an array`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { bodyJson: null, batchSize: null, parseError: `JSON parse failed: ${msg}` };
  }
}

function describeJsonType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** A body that cannot be decoded as UTF-8 is still recorded, as a hex prefix. */
export function bodyToText(buf: Buffer): { text: string; wasBinary: boolean } {
  const text = buf.toString("utf8");
  // A lossy decode replaces bad sequences with U+FFFD; if the round trip does
  // not preserve length the body was not valid UTF-8.
  if (Buffer.byteLength(text, "utf8") !== buf.length) {
    return { text: `<binary ${buf.length} bytes; hex prefix ${buf.subarray(0, 64).toString("hex")}>`, wasBinary: true };
  }
  return { text, wasBinary: false };
}
