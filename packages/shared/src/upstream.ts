import { z } from "zod";

/**
 * The upstream ADMS webhook event, as documented by the vendor.
 *
 * Deliberately permissive: the vendor's sample JSON spells the verify-type key
 * `VerifyType`, their reference PHP reads `VeryfyType`. Phase 0 settles which
 * (or both) is real. Until then every field is optional and unknown keys are
 * kept (`looseObject`) so nothing is silently dropped on the floor.
 */
export const upstreamEventSchema = z.looseObject({
  EmpId: z.string().optional(),
  AttTime: z.string().optional(),
  CheckingStatus: z.string().optional(),
  VerifyType: z.string().optional(),
  VeryfyType: z.string().optional(),
  DeviceID: z.string().optional(),
});

export type UpstreamEvent = z.infer<typeof upstreamEventSchema>;

/** The vendor's `AttTime` wire format: `YYYY-MM-DD HH:mm:ss`, no offset. */
export const ATT_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
