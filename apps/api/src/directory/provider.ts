import type { Branch } from "../db/schema/index.js";

/**
 * Where the person directory comes from.
 *
 * Today the only source is a spreadsheet. The middleware vendor exposes a
 * REST API that already holds names (ADMS's own employee list), so a
 * `VendorApiDirectoryProvider` is a realistic second implementation rather
 * than a hypothetical one.
 *
 * Nothing outside this folder may know which implementation is in use
 * (specification §6). The import routine, the admin screens and the
 * processor all work in terms of `DirectoryRecord` and this interface; the
 * choice is configuration.
 */
export interface DirectoryRecord {
  /** The enrolment number assigned on the physical reader. */
  enrollNo: string;
  fullName: string;
  /** Null when the source names no group: the branch follows the group. */
  branch: Branch | null;
  /**
   * Group name as written by the source; resolved to a row on import. Null
   * for someone the source has not classified yet — they join the
   * directory, their scans get their name, and they sit on the register in
   * no group and expected nowhere until the office puts them in one.
   */
  groupName: string | null;
  tutorInitials: string | null;
  admissionNo: string | null;
  /** The place in the group's list, as the school orders it. */
  displayOrder: number | null;
}

export interface PersonDirectoryProvider {
  readonly name: string;
  listAll(): Promise<DirectoryRecord[]>;
  findByEnrollNo(enrollNo: string): Promise<DirectoryRecord | null>;
  /**
   * Whether the source can be polled for changes. False for a spreadsheet,
   * which only ever arrives by someone uploading it; true for an API, which
   * a future scheduled sync could read.
   */
  supportsLiveSync(): boolean;
}

/**
 * The spreadsheet provider. Constructed around the text of one uploaded
 * file, because that is the whole of its world: there is nothing to poll.
 */
export class CsvDirectoryProvider implements PersonDirectoryProvider {
  readonly name = "csv";

  constructor(private readonly records: readonly DirectoryRecord[]) {}

  listAll(): Promise<DirectoryRecord[]> {
    return Promise.resolve([...this.records]);
  }

  findByEnrollNo(enrollNo: string): Promise<DirectoryRecord | null> {
    return Promise.resolve(
      this.records.find((r) => r.enrollNo === enrollNo) ?? null,
    );
  }

  supportsLiveSync(): boolean {
    return false;
  }
}

/**
 * The seam for the vendor's API.
 *
 * Deliberately not implemented: VFT have not published documentation and we
 * have no service credential, so anything written now would be guesswork
 * that looks like a feature. What it needs when the time comes:
 *
 *   - a base URL and credential in configuration, never a person's login;
 *   - a mapping from their employee record to DirectoryRecord, in this file
 *     and nowhere else;
 *   - `supportsLiveSync()` returning true, and a scheduled reconcile that
 *     uses the same import planner the spreadsheet does, so both sources go
 *     through one reviewed diff rather than two write paths.
 *
 * Selecting it must be configuration (`DIRECTORY_PROVIDER=vendor_api`), not
 * an edit anywhere outside this folder.
 */
export const VENDOR_API_PROVIDER_NOT_IMPLEMENTED =
  "The vendor API directory provider is not implemented. See src/directory/provider.ts.";
