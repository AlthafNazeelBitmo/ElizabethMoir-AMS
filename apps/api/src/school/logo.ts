import { createHash } from "node:crypto";
import type { SettingsService } from "../settings/service.js";

/**
 * The school's mark, kept with the other school settings.
 *
 * It lives in the database rather than on disk because the interim host
 * has no disk that survives a deployment, and because the crest is the
 * school's, not the code's — it must never be committed. It is small (a
 * crest for a sidebar), so a base64 string in the settings table is the
 * whole of it.
 */

export const LOGO_SETTING_KEY = "school_logo";
export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
]);

export interface StoredLogo {
  mime: string;
  /** Base64. */
  data: string;
}

function isStoredLogo(value: unknown): value is StoredLogo {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StoredLogo).mime === "string" &&
    typeof (value as StoredLogo).data === "string" &&
    LOGO_TYPES.has((value as StoredLogo).mime)
  );
}

export async function readLogo(
  settings: SettingsService,
): Promise<{ mime: string; bytes: Buffer; version: string } | null> {
  const raw = await settings.getRaw(LOGO_SETTING_KEY);
  if (!isStoredLogo(raw)) return null;
  const bytes = Buffer.from(raw.data, "base64");
  return { mime: raw.mime, bytes, version: versionOf(bytes) };
}

/** A short content hash: the browser re-fetches when it changes and not otherwise. */
export function versionOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}
