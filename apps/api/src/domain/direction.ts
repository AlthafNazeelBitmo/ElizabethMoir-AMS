import type {
  DeviceDirection,
  Direction,
  DirectionSource,
} from "../db/schema/index.js";

/**
 * Deciding whether a scan was an arrival or a departure.
 *
 * The readers do not reliably say. The rules below are tried in order and
 * the one that fired is recorded on the scan, so any figure derived from a
 * direction can be traced back to the reason it was chosen — and so that
 * when the discovery run finally says what `CheckingStatus` means, the
 * scans decided by the weaker rules can be found and recomputed.
 */

export interface DeviceConfig {
  direction: DeviceDirection;
  trustCheckingStatus: boolean;
}

export interface DirectionContext {
  /** Keyed by device serial. An unseen device is treated as bidirectional. */
  devices: ReadonlyMap<string, DeviceConfig>;
  /**
   * What each `CheckingStatus` value means, from settings. Empty until the
   * discovery run says — and consulted only for devices an administrator has
   * explicitly marked as trustworthy.
   */
  statusMap: Readonly<Record<string, Direction>>;
  /** Two taps on one device inside this window are one movement. */
  duplicateWindowSeconds: number;
}

export interface DayScanInput {
  attTime: Date;
  deviceSerial: string;
  checkingStatus: string | null;
}

export interface ResolvedDirection {
  direction: Direction;
  directionSource: DirectionSource;
  /**
   * A repeat tap inside the duplicate window. The raw scan is still stored
   * (specification §7: keep both raw rows); this flag is what keeps it from
   * counting twice in the derived day record.
   */
  isDuplicate: boolean;
}

const UNSEEN_DEVICE: DeviceConfig = {
  direction: "both",
  trustCheckingStatus: false,
};

/**
 * Resolves a whole person-day at once, in time order.
 *
 * The sequence rule is inherently sequential — a scan's direction depends on
 * how many movements preceded it that day — so resolving one scan in
 * isolation is not possible without lying about the context. Doing the day
 * together also means an event that arrives late, out of order, simply
 * re-runs the day and corrects everything after it.
 */
export function resolveDayDirections(
  scans: readonly DayScanInput[],
  ctx: DirectionContext,
): ResolvedDirection[] {
  const ordered = [...scans]
    .map((scan, index) => ({ scan, index }))
    .sort(
      (a, b) =>
        a.scan.attTime.getTime() - b.scan.attTime.getTime() ||
        a.index - b.index,
    );

  const results: ResolvedDirection[] = new Array<ResolvedDirection>(
    scans.length,
  );
  /**
   * This person's last tap that counted as a movement, whichever reader
   * saw it. The window is measured from that tap, not from the most
   * recent repeat of it: measured from the repeat, a person tapping every
   * fifty seconds would be one movement all day.
   *
   * Across readers as well as on one, because a person is in one place: a
   * tap on another reader seconds later is the same passage seen twice —
   * two readers at one door, or one reader reporting under two serials —
   * and counting it as a second movement turns an arrival into a
   * departure the moment somebody taps twice. The exception is a pair of
   * doors the school has told us about, below.
   */
  let lastMovement:
    | { at: Date; result: ResolvedDirection; deviceSerial: string }
    | null = null;
  /** Movements so far today, duplicates excluded. Drives the alternation. */
  let movementCount = 0;

  for (const { scan, index } of ordered) {
    const device = ctx.devices.get(scan.deviceSerial) ?? UNSEEN_DEVICE;

    const previous = lastMovement;
    const withinWindow =
      previous !== null &&
      (scan.attTime.getTime() - previous.at.getTime()) / 1000 <
        ctx.duplicateWindowSeconds;
    const isDuplicate =
      withinWindow &&
      !opposedDoors(
        ctx.devices.get(previous.deviceSerial) ?? UNSEEN_DEVICE,
        device,
      );

    if (isDuplicate) {
      // People tap twice. The repeat takes the direction of the tap it
      // repeats, so it can never flip the alternation.
      results[index] = {
        direction: previous.result.direction,
        directionSource: previous.result.directionSource,
        isDuplicate: true,
      };
      continue;
    }

    const result = resolveOne(scan, device, ctx, movementCount);
    results[index] = result;
    lastMovement = {
      at: scan.attTime,
      result,
      deviceSerial: scan.deviceSerial,
    };

    // An undecidable scan does not advance the alternation: guessing past it
    // would corrupt every direction after it as well.
    if (result.direction !== "unknown") movementCount += 1;
  }

  return results;
}

/**
 * Whether two readers are a way in and a way out that an administrator
 * has told us about. Only then is a tap on each a second passage rather
 * than the same one seen twice: the school knows where its readers are
 * mounted, and that knowledge outranks the window. Two readers nobody has
 * configured are a guess, and a guess must not invent a departure.
 */
function opposedDoors(previous: DeviceConfig, current: DeviceConfig): boolean {
  const explicit = (d: DeviceConfig) =>
    d.direction === "entry" || d.direction === "exit";
  return (
    explicit(previous) && explicit(current) && previous.direction !== current.direction
  );
}

function resolveOne(
  scan: DayScanInput,
  device: DeviceConfig,
  ctx: DirectionContext,
  movementCount: number,
): ResolvedDirection {
  // 1. Device configuration. An administrator has said where this reader is
  //    mounted and which way people pass it. Highest confidence there is.
  if (device.direction === "entry") {
    return { direction: "in", directionSource: "device", isDuplicate: false };
  }
  if (device.direction === "exit") {
    return { direction: "out", directionSource: "device", isDuplicate: false };
  }

  // 2. The device's own flag, but only where an administrator has enabled it
  //    after seeing evidence that it means anything on that device.
  if (device.trustCheckingStatus && scan.checkingStatus !== null) {
    const mapped = ctx.statusMap[scan.checkingStatus];
    if (mapped === "in" || mapped === "out") {
      return {
        direction: mapped,
        directionSource: "status",
        isDuplicate: false,
      };
    }
  }

  // 3. Alternation. The first movement of the day is an arrival; they
  //    alternate after that.
  if (device.direction === "both") {
    return {
      direction: movementCount % 2 === 0 ? "in" : "out",
      directionSource: "sequence",
      isDuplicate: false,
    };
  }

  // 4. Nothing applied. Recorded rather than guessed, and surfaced in admin.
  return {
    direction: "unknown",
    directionSource: "sequence",
    isDuplicate: false,
  };
}

/**
 * Validates a status→direction map loaded from settings, dropping anything
 * that is not a direction. Settings are operator input and reach this code
 * as data.
 */
export function parseStatusMap(raw: unknown): Record<string, Direction> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, Direction> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === "in" || value === "out") out[key] = value;
  }
  return out;
}
