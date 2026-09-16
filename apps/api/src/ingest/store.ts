import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client.js";
import { rawEvents } from "../db/schema.js";
import { envelopeToRow, type Envelope } from "./envelope.js";
import type { Spool } from "./spool.js";

export type SaveOutcome = "db" | "spool" | "lost";

/**
 * Where an envelope goes: the database if it will take it, the disk spool if
 * not, and — only if both are broken — a loud error log. The webhook has no
 * retry, so this is the last line of defence against losing a scan.
 */
export class RawEventStore {
  constructor(
    private readonly db: Db,
    private readonly spool: Spool,
    private readonly log: FastifyBaseLogger,
  ) {}

  async insert(envelope: Envelope): Promise<void> {
    await this.db.insert(rawEvents).values(envelopeToRow(envelope));
  }

  async save(envelope: Envelope): Promise<SaveOutcome> {
    try {
      await this.insert(envelope);
      return "db";
    } catch (dbErr) {
      this.log.warn({ err: errSummary(dbErr) }, "raw_events insert failed; spooling to disk");
    }
    try {
      await this.spool.write(envelope);
      return "spool";
    } catch (spoolErr) {
      this.log.error(
        { err: errSummary(spoolErr), bodyBytes: envelope.bodyBytes, batchSize: envelope.batchSize },
        "raw event LOST: database and spool both unavailable",
      );
      return "lost";
    }
  }

  /** Periodic reconciler: pushes spooled envelopes into the database. */
  async drainSpool(): Promise<void> {
    let result: { drained: number; remaining: number };
    try {
      result = await this.spool.drain((e) => this.insert(e));
    } catch (err) {
      this.log.error({ err: errSummary(err) }, "spool drain failed");
      return;
    }
    if (result.drained > 0 || result.remaining > 0) {
      this.log.info(result, "spool drain");
    }
  }
}

function errSummary(err: unknown): { name: string; message: string; code?: string } {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return { name: err.name, message: err.message, ...(typeof code === "string" ? { code } : {}) };
  }
  return { name: "UnknownError", message: String(err) };
}
