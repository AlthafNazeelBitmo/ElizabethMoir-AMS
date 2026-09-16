import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Envelope } from "./envelope.js";

/**
 * Disk fallback for envelopes the database refused. Files are written
 * atomically (tmp + rename) so a crash mid-write cannot leave a half file
 * that later fails to replay. Drained in name order, which is arrival order.
 */
export class Spool {
  private available = false;

  constructor(private readonly dir: string) {}

  /**
   * Creates the directory. Failure (a read-only filesystem, say) is
   * reported rather than thrown: an unusable spool degrades the fallback,
   * it must not stop the ingest endpoint from answering.
   */
  async init(): Promise<boolean> {
    try {
      await mkdir(this.dir, { recursive: true });
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  async write(envelope: Envelope): Promise<string> {
    if (!this.available) throw new Error(`spool directory unavailable: ${this.dir}`);
    const stamp = envelope.receivedAt.replace(/[:.]/g, "-");
    const name = `${stamp}-${randomUUID()}.json`;
    const final = path.join(this.dir, name);
    const tmp = `${final}.tmp`;
    await writeFile(tmp, JSON.stringify(envelope), "utf8");
    await rename(tmp, final);
    return name;
  }

  async list(): Promise<string[]> {
    const names = await readdir(this.dir);
    return names.filter((n) => n.endsWith(".json")).sort();
  }

  async read(name: string): Promise<Envelope> {
    const text = await readFile(path.join(this.dir, name), "utf8");
    return JSON.parse(text) as Envelope;
  }

  async remove(name: string): Promise<void> {
    await unlink(path.join(this.dir, name));
  }

  /**
   * Replays spooled envelopes through `persist` in order. Stops at the first
   * failure (the database is presumably still down) and reports progress.
   */
  async drain(persist: (e: Envelope) => Promise<void>): Promise<{ drained: number; remaining: number }> {
    if (!this.available) return { drained: 0, remaining: 0 };
    const names = await this.list();
    let drained = 0;
    for (const name of names) {
      const envelope = await this.read(name);
      try {
        await persist(envelope);
      } catch {
        return { drained, remaining: names.length - drained };
      }
      await this.remove(name);
      drained += 1;
    }
    return { drained, remaining: 0 };
  }
}
