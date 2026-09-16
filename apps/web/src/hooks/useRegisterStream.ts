import { useEffect, useRef, useState } from "react";
import type { RegisterRow } from "../lib/api.js";

/**
 * The live connection behind the register.
 *
 * Connection state is deliberately visible to the caller. The one thing
 * this screen must never do is show stale data as though it were live: if
 * the stream drops, the user is told, and told what time the data is from.
 */

export type ConnectionState = "connecting" | "live" | "reconnecting";

export interface ScanEventPayload extends RegisterRow {
  type: "scan";
  date: string;
}

export interface UseRegisterStreamOptions {
  /** Called for each scan event that survives the server's role filter. */
  onScan: (event: ScanEventPayload) => void;
  /** The server could not fill the gap; everything on screen may be stale. */
  onResync: () => void;
  enabled?: boolean;
}

export interface RegisterStream {
  state: ConnectionState;
  /** When data was last known to be current. Shown when the stream drops. */
  lastContactAt: Date | null;
}

export function useRegisterStream({
  onScan,
  onResync,
  enabled = true,
}: UseRegisterStreamOptions): RegisterStream {
  const [state, setState] = useState<ConnectionState>("connecting");
  const [lastContactAt, setLastContactAt] = useState<Date | null>(null);

  // Held in refs so reconnecting does not need the effect to re-run, which
  // would tear down the connection every time the parent re-rendered.
  const onScanRef = useRef(onScan);
  const onResyncRef = useRef(onResync);
  onScanRef.current = onScan;
  onResyncRef.current = onResync;

  useEffect(() => {
    if (!enabled) return;

    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let attempt = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      // EventSource reconnects on its own and replays Last-Event-ID for us.
      source = new EventSource("/api/register/stream", {
        withCredentials: true,
      });

      source.addEventListener("open", () => {
        attempt = 0;
        setState("live");
        setLastContactAt(new Date());
      });

      source.addEventListener("hello", () => {
        setState("live");
        setLastContactAt(new Date());
      });

      source.addEventListener("heartbeat", () => {
        setLastContactAt(new Date());
      });

      source.addEventListener("scan", (event) => {
        setLastContactAt(new Date());
        try {
          const parsed = JSON.parse(
            (event as MessageEvent<string>).data,
          ) as ScanEventPayload;
          onScanRef.current(parsed);
        } catch {
          // A malformed frame is not worth tearing the connection down for.
        }
      });

      source.addEventListener("resync", () => {
        // The server could not replay what we missed, so the screen is
        // refetched rather than left with holes in it.
        onResyncRef.current();
      });

      source.addEventListener("error", () => {
        setState("reconnecting");
        source?.close();
        if (closed) return;
        // Back off, but never further than ten seconds: this screen is on a
        // wall and nobody is watching it to press refresh.
        attempt += 1;
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
        retryTimer = window.setTimeout(connect, delay);
      });
    };

    connect();

    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      source?.close();
    };
  }, [enabled]);

  return { state, lastContactAt };
}
