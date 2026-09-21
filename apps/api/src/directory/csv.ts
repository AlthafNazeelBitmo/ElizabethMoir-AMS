/**
 * Reading the school's spreadsheet.
 *
 * This is a deliberately small RFC 4180 parser rather than a dependency.
 * The input is one narrow, known shape — an export from a school's
 * spreadsheet — and the failure modes that matter (a BOM, CRLF line
 * endings, a quoted field containing a comma or a newline, doubled quotes)
 * are each covered by a test. A general-purpose parser would bring more
 * behaviour than this needs on a path that handles children's records.
 */

/** Splits CSV text into rows of raw string cells. Never throws. */
export function parseCsv(text: string): string[][] {
  // A spreadsheet export usually carries a byte-order mark; left in place it
  // becomes part of the first header name and every column "goes missing".
  const input = text.replace(/^﻿/, "");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"'; // an escaped quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += char;
      i += 1;
      continue;
    }

    if (char === '"' && cell === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endCell();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // CRLF or a lone CR both end the row.
      endRow();
      i += input[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }
    cell += char;
    i += 1;
  }

  // A trailing newline should not produce a final empty row.
  if (cell !== "" || row.length > 0) endRow();

  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
}

export const REQUIRED_COLUMNS = [
  "enroll_no",
  "full_name",
  "branch",
  "group",
] as const;
export const OPTIONAL_COLUMNS = [
  "tutor_initials",
  "admission_no",
  "display_order",
  "category",
] as const;
export const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS] as const;

export type ColumnName = (typeof ALL_COLUMNS)[number];

/** A header cell matched loosely: case, spaces and hyphens do not matter. */
function normaliseHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export interface CsvRow {
  /** The line number in the file as a person would count it, header included. */
  lineNumber: number;
  values: Record<ColumnName, string>;
}

export interface CsvProblem {
  /** Null for problems with the file as a whole rather than one row. */
  lineNumber: number | null;
  column: ColumnName | null;
  message: string;
}

export interface CsvReadResult {
  rows: CsvRow[];
  problems: CsvProblem[];
}

/**
 * Maps the file onto the expected columns and reports anything missing.
 * Content is not validated here — only the shape of the file.
 */
export function readDirectoryCsv(text: string): CsvReadResult {
  const problems: CsvProblem[] = [];
  const table = parseCsv(text);

  if (table.length === 0) {
    return {
      rows: [],
      problems: [
        { lineNumber: null, column: null, message: "The file is empty." },
      ],
    };
  }

  const header = table[0]!.map(normaliseHeader);
  const index = new Map<string, number>();
  header.forEach((name, i) => {
    if (!index.has(name)) index.set(name, i);
  });

  for (const required of REQUIRED_COLUMNS) {
    if (!index.has(required)) {
      problems.push({
        lineNumber: 1,
        column: required,
        message: `The file has no "${required}" column. Expected columns: ${ALL_COLUMNS.join(", ")}.`,
      });
    }
  }
  if (problems.length > 0) return { rows: [], problems };

  const rows: CsvRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    const lineNumber = r + 1;

    const values = {} as Record<ColumnName, string>;
    for (const column of ALL_COLUMNS) {
      const at = index.get(column);
      values[column] = at === undefined ? "" : (cells[at] ?? "").trim();
    }

    // A row that is entirely blank is a spreadsheet artefact, not an error.
    if (ALL_COLUMNS.every((c) => values[c] === "")) continue;

    rows.push({ lineNumber, values });
  }

  return { rows, problems };
}
