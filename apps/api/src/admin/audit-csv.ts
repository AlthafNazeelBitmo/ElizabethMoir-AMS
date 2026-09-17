import { csvRow } from "../reports/csv.js";

/** One row of the audit log as the export sees it. */
export interface AuditExportEntry {
  id: number;
  action: string;
  entity: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
  userEmail: string | null;
  userName: string | null;
}

export interface AuditCsvContext {
  filtersDescription: string;
  generatedAt: Date;
}

/**
 * The audit log as a file.
 *
 * Same discipline as the attendance export: every field quoted, formula
 * prefixes defused. The before/after columns hold JSON, which a spreadsheet
 * shows as text — it is there so the file is complete, not so it is pretty.
 * The address a change came from is deliberately not included, for the
 * same reason the screen does not show it.
 */
export function auditLogToCsv(
  entries: readonly AuditExportEntry[],
  context: AuditCsvContext,
): string {
  const lines: string[] = [];

  lines.push(csvRow(["Audit log"]));
  lines.push(csvRow([context.filtersDescription]));
  lines.push(csvRow([`${entries.length} entries, newest first`]));
  lines.push(csvRow([`Generated ${context.generatedAt.toISOString()}`]));
  lines.push("");

  lines.push(
    csvRow([
      "ID",
      "When (UTC)",
      "Who",
      "Email",
      "Action",
      "Entity",
      "Entity ID",
      "Before",
      "After",
    ]),
  );

  for (const entry of entries) {
    lines.push(
      csvRow([
        entry.id,
        entry.createdAt.toISOString(),
        entry.userName ?? "",
        entry.userEmail ?? "",
        entry.action,
        entry.entity ?? "",
        entry.entityId ?? "",
        entry.before === null || entry.before === undefined
          ? ""
          : JSON.stringify(entry.before),
        entry.after === null || entry.after === undefined
          ? ""
          : JSON.stringify(entry.after),
      ]),
    );
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
