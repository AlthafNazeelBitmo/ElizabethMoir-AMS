import { randomBytes } from "node:crypto";
import type { Branch, DayStatus, UserRole } from "../db/schema/index.js";
import { canSeeStaff } from "../auth/scope.js";

/**
 * The live feed behind the register.
 *
 * In-memory, deliberately. A published event is a hint that something
 * changed, never the source of truth — the register's data comes from the
 * database, and a client that misses everything still has a correct screen
 * after a refetch. That makes a process restart a dropped connection rather
 * than lost data, and keeps Redis out of the critical path.
 *
 * Every event carries a monotonic id. A client reconnecting sends
 * `Last-Event-ID` and gets whatever it missed from the buffer; if its id is
 * older than the buffer reaches, it is told to refetch instead of being
 * quietly given a partial history.
 *
 * The ids only mean anything within one process. Each broadcaster carries
 * a random identity, sent with every greeting, so a client that reconnects
 * to a different process — after a restart, or on a host that runs several
 * — can see that its `Last-Event-ID` was never going to be understood and
 * refetch, rather than trusting an empty replay.
 */

export interface ScanEvent {
  type: "scan";
  personId: string;
  fullName: string;
  enrollNo: string;
  branch: Branch | null;
  groupId: number | null;
  groupName: string | null;
  tutorInitials: string | null;
  date: string;
  firstIn: string | null;
  lastOut: string | null;
  status: DayStatus;
  isLate: boolean;
  hasManualEdit: boolean;
  scanCount: number;
}

export interface SummaryEvent {
  type: "summary";
  date: string;
  branch: Branch;
  counts: Record<DayStatus | "total" | "late", number>;
}

export type RegisterEvent = ScanEvent | SummaryEvent;

export interface Published {
  id: number;
  event: RegisterEvent;
}

export type Subscriber = (published: Published) => void;

/** How many events a reconnecting client can catch up on. */
const BUFFER_SIZE = 500;

export class RegisterBroadcaster {
  /** This process's identity: ids are only comparable under the same one. */
  readonly instanceId = randomBytes(6).toString("hex");
  private nextId = 1;
  private readonly buffer: Published[] = [];
  private readonly subscribers = new Set<{
    role: UserRole;
    deliver: Subscriber;
  }>();

  publish(event: RegisterEvent): Published {
    const published: Published = { id: this.nextId++, event };
    this.buffer.push(published);
    if (this.buffer.length > BUFFER_SIZE) this.buffer.shift();

    for (const subscriber of this.subscribers) {
      if (!isVisibleTo(event, subscriber.role)) continue;
      try {
        subscriber.deliver(published);
      } catch {
        // A broken pipe on one client must not stop the others.
      }
    }
    return published;
  }

  subscribe(role: UserRole, deliver: Subscriber): () => void {
    const entry = { role, deliver };
    this.subscribers.add(entry);
    return () => this.subscribers.delete(entry);
  }

  /**
   * Events after `lastEventId` that this role may see. Returns null when the
   * gap is too large to fill, so the caller can tell the client to refetch
   * rather than showing it a screen with holes in it.
   */
  replay(lastEventId: number, role: UserRole): Published[] | null {
    const oldest = this.buffer[0];
    if (oldest === undefined) return [];
    if (lastEventId < oldest.id - 1) return null;
    return this.buffer.filter(
      (p) => p.id > lastEventId && isVisibleTo(p.event, role),
    );
  }

  get lastEventId(): number {
    return this.nextId - 1;
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}

/**
 * Role filtering, applied before a byte reaches the socket.
 *
 * The specification is absolute that a `student_only` session never
 * receives a staff event. Filtering on the server rather than in the
 * browser is the difference between a rule and a suggestion.
 *
 * An event whose branch is unknown — a person nobody has put in a group —
 * is treated as not visible to a student-only account, matching the
 * register query, which excludes them for the same reason.
 */
export function isVisibleTo(event: RegisterEvent, role: UserRole): boolean {
  if (canSeeStaff(role)) return true;
  return event.branch === "student";
}
