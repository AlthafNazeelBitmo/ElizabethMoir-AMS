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
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async write(envelope: Envelope): Promise<string> {
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
