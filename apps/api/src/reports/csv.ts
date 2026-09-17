import type { AttendanceReport } from "./service.js";
import { formatArrival } from "./service.js";

/**
 * Writing a report as CSV.
 *
 * Every field is quoted and every embedded quote doubled. That is not
 * fussiness: a name containing a comma would otherwise silently shift every
 * column after it, and a spreadsheet would show the wrong group against the
 * wrong child without anything appearing to have gone wrong.
 *
 * Fields are also protected against formula injection. A value beginning
 * `=`, `+`, `-` or `@` is executed as a formula when a spreadsheet opens the
 * file; since names in this system come from an uploaded file and
 * enrolment numbers come from an unauthenticated webhook, neither is
 * trusted enough to hand a spreadsheet unescaped.
 */

const RISKY_PREFIX = /^[=+\-@\t\r]/;

export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  const text = String(value);
  const guarded = RISKY_PREFIX.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function csvRow(
  values: Array<string | number | null | undefined>,
): string {
  return values.map(csvField).join(",");
}

export interface CsvContext {
  /** Printed in the header so a saved file explains itself. */
  filtersDescription: string;
  generatedAt: Date;
}

export function attendanceReportToCsv(
  report: AttendanceReport,
  context: CsvContext,
): string {
  const lines: string[] = [];

  // A preamble, so a file found on someone's desktop in March still says
  // what it covers and what was filtered out of it.
  lines.push(csvRow(["Attendance report"]));
  lines.push(csvRow([`${report.from} to ${report.to}`]));
  lines.push(csvRow([context.filtersDescription]));
  lines.push(csvRow([`School days in range: ${report.schoolDaysInRange}`]));
  lines.push(csvRow([`Generated ${context.generatedAt.toISOString()}`]));
  lines.push("");

  lines.push(
    csvRow([
      "Name",
      "ID",
      "Group",
      "Tutor",
      "Days present",
      "Days absent",
      "Days expected",
      "Late",
      "Attendance %",
      "Average arrival",
    ]),
  );

  // The aggregate sits directly under the header, as it does on screen.
  lines.push(
    csvRow([
      `All ${report.totals.people} people`,
      "",
      "",
      "",
      report.totals.daysPresent,
      report.totals.daysAbsent,
      report.totals.daysExpected,
      report.totals.lateCount,
      report.totals.attendancePercentage ?? "",
      formatArrival(report.totals.averageArrivalSeconds),
    ]),
  );

  for (const row of report.rows) {
    lines.push(
      csvRow([
        row.fullName,
        row.enrollNo,
        row.groupName ?? "",
        row.tutorInitials ?? "",
        row.daysPresent,
        row.daysAbsent,
        row.daysExpected,
        row.lateCount,
        row.attendancePercentage ?? "",
        formatArrival(row.averageArrivalSeconds),
      ]),
    );
  }

  // CRLF and a byte-order mark: what Excel expects, and without the mark it
  // renders non-ASCII names as mojibake.
  return `﻿${lines.join("\r\n")}\r\n`;
}
