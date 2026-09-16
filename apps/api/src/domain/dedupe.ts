import { createHash } from "node:crypto";

/**
 * The key that makes replay, redelivery and overlapping backfills safe
 * (specification §5).
 *
 *   sha256(enroll_no | att_time_local | device_serial | checking_status)
 *
 * `att_time_local` is the string exactly as transmitted, not the converted
 * instant: if the configured timezone is ever corrected, every scan's UTC
 * time changes but its identity must not, or a replay would duplicate the
 * entire history.
 *
 * `checking_status` is part of the key on purpose. The vendor's own sample
 * contains the same person at the same second on the same device with
 * different statuses. Until the discovery run says whether that is a real
 * pair or an artefact of their software, both rows are preserved — losing a
 * real scan is worse than keeping a duplicate, and the duplicate is
 * collapsed in the derived day record anyway.
 */
export function dedupeKey(parts: {
  enrollNo: string;
  attTimeLocal: string;
  deviceSerial: string;
  checkingStatus: string | null;
}): string {
  const material = [
    parts.enrollNo,
    parts.attTimeLocal,
    parts.deviceSerial,
    parts.checkingStatus ?? "",
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}
