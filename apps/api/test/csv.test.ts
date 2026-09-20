import { describe, expect, it } from "vitest";
import { parseCsv, readDirectoryCsv } from "../src/directory/csv.js";
import type { DirectoryRecord } from "../src/directory/provider.js";
import {
  validateDirectoryCsv,
  type KnownGroup,
} from "../src/directory/validate.js";
import {
  hashPlan,
  planImport,
  type ExistingPerson,
} from "../src/directory/plan.js";

const GROUPS: KnownGroup[] = [
  { id: 1, name: "Form 1", branch: "student" },
  { id: 2, name: "Upper 6", branch: "student" },
  { id: 3, name: "Junior Staff", branch: "staff" },
];

const HEADER = "enroll_no,full_name,branch,group,tutor_initials,admission_no";

describe("parseCsv", () => {
  it("parses a plain file", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a byte-order mark, which spreadsheets add and which hides the first column", () => {
    const rows = parseCsv("﻿enroll_no,full_name\n1,Ann");
    expect(rows[0]).toEqual(["enroll_no", "full_name"]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles a lone carriage return", () => {
    expect(parseCsv("a,b\r1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('a,b\n"Perera, Ann",2')).toEqual([
      ["a", "b"],
      ["Perera, Ann", "2"],
    ]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('a,b\n"line one\nline two",2')).toEqual([
      ["a", "b"],
      ["line one\nline two", "2"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('a\n"She said ""hello"""')).toEqual([
      ["a"],
      ['She said "hello"'],
    ]);
  });

  it("does not leave a trailing empty row", () => {
    expect(parseCsv("a,b\n1,2\n")).toHaveLength(2);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("readDirectoryCsv", () => {
  it("names every missing column rather than failing generically", () => {
    const { problems } = readDirectoryCsv("enroll_no,full_name\n1,Ann");
    const messages = problems.map((p) => p.message).join(" ");
    expect(messages).toMatch(/"branch" column/);
    expect(messages).toMatch(/"group" column/);
  });

  it("accepts headers in any case or spacing", () => {
    const { rows, problems } = readDirectoryCsv(
      "Enroll No,Full Name,BRANCH,Group\n1,Ann,student,Form 1",
    );
    expect(problems).toEqual([]);
    expect(rows[0]?.values.full_name).toBe("Ann");
  });

  it("treats the optional columns as optional", () => {
    const { rows, problems } = readDirectoryCsv(
      "enroll_no,full_name,branch,group\n1,Ann,student,Form 1",
    );
    expect(problems).toEqual([]);
    expect(rows[0]?.values.tutor_initials).toBe("");
  });

  it("numbers rows the way a person reading the file would", () => {
    const { rows } = readDirectoryCsv(
      `${HEADER}\n1,Ann,student,Form 1,,\n2,Ben,student,Form 1,,`,
    );
    expect(rows.map((r) => r.lineNumber)).toEqual([2, 3]);
  });

  it("skips blank rows left behind by a spreadsheet", () => {
    const { rows } = readDirectoryCsv(
      `${HEADER}\n1,Ann,student,Form 1,,\n,,,,,\n2,Ben,student,Form 1,,`,
    );
    expect(rows).toHaveLength(2);
  });

  it("reports an empty file", () => {
    expect(readDirectoryCsv("").problems[0]?.message).toMatch(/empty/i);
  });
});

describe("validateDirectoryCsv", () => {
  const valid = `${HEADER}
11007,Ann Perera,student,Form 1,AP,2024/001
2001,Ben Silva,staff,Junior Staff,,`;

  it("accepts a well-formed file", () => {
    const { records, problems } = validateDirectoryCsv(valid, GROUPS);
    expect(problems).toEqual([]);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      enrollNo: "11007",
      fullName: "Ann Perera",
      branch: "student",
      groupName: "Form 1",
      tutorInitials: "AP",
      admissionNo: "2024/001",
      displayOrder: null,
    });
    expect(records[1]?.tutorInitials).toBeNull();
  });

  it("reports every bad row, not just the first", () => {
    const text = `${HEADER}
,Ann,student,Form 1,,
11008,,student,Form 1,,
11009,Cal,alien,Form 1,,`;
    const { problems } = validateDirectoryCsv(text, GROUPS);
    expect(problems.map((p) => p.lineNumber)).toEqual([2, 3, 4]);
  });

  it("names the line and the column for each problem", () => {
    const { problems } = validateDirectoryCsv(
      `${HEADER}\n,Ann,student,Form 1,,`,
      GROUPS,
    );
    expect(problems[0]).toMatchObject({ lineNumber: 2, column: "enroll_no" });
    expect(problems[0]?.message).toMatch(/required/);
  });

  it("writes no records at all when any row is bad", () => {
    // All-or-nothing is enforced by the caller, but a bad row must never
    // itself become a record.
    const { records } = validateDirectoryCsv(
      `${HEADER}\n11007,Ann,student,Nonexistent,,`,
      GROUPS,
    );
    expect(records).toHaveLength(0);
  });

  it("rejects an unknown group and lists the ones that exist", () => {
    const { problems } = validateDirectoryCsv(
      `${HEADER}\n11007,Ann,student,Form 9,,`,
      GROUPS,
    );
    expect(problems[0]?.message).toMatch(/does not exist/);
    expect(problems[0]?.message).toMatch(/Form 1/);
  });

  it("rejects a row whose branch and group disagree", () => {
    // The mistake most likely to put a staff member in front of a
    // student-only account.
    const { problems } = validateDirectoryCsv(
      `${HEADER}\n11007,Ann,student,Junior Staff,,`,
      GROUPS,
    );
    expect(problems[0]?.message).toMatch(
      /staff branch, but the row says student/,
    );
  });

  it("rejects a duplicate enrolment number and says where the first one was", () => {
    const text = `${HEADER}\n11007,Ann,student,Form 1,,\n11007,Ben,student,Form 1,,`;
    const { problems } = validateDirectoryCsv(text, GROUPS);
    expect(problems[0]?.lineNumber).toBe(3);
    expect(problems[0]?.message).toMatch(/also appears on line 2/);
  });

  it("rejects an enrolment number containing a space", () => {
    const { problems } = validateDirectoryCsv(
      `${HEADER}\n11 007,Ann,student,Form 1,,`,
      GROUPS,
    );
    expect(problems[0]?.message).toMatch(/contains a space/);
  });

  it("matches group names regardless of case and spacing", () => {
    const { records, problems } = validateDirectoryCsv(
      `${HEADER}\n11007,Ann,student,  form   1 ,,`,
      GROUPS,
    );
    expect(problems).toEqual([]);
    expect(records[0]?.groupName).toBe("Form 1");
  });

  it("reports a file with a header and no rows", () => {
    expect(validateDirectoryCsv(HEADER, GROUPS).problems[0]?.message).toMatch(
      /no rows/,
    );
  });

  it("accepts a row with no group and no branch: in the directory, unclassified", () => {
    const { records, problems } = validateDirectoryCsv(
      `${HEADER}
11007,Ann,,,,`,
      GROUPS,
    );
    expect(problems).toEqual([]);
    expect(records[0]).toMatchObject({ groupName: null, branch: null });
  });

  it("still requires a branch once a group is named", () => {
    const { problems } = validateDirectoryCsv(
      `${HEADER}
11007,Ann,,Form 1,,`,
      GROUPS,
    );
    expect(problems[0]?.column).toBe("branch");
  });
});

describe("planImport", () => {
  const record = (
    enrollNo: string,
    over: Partial<DirectoryRecord> = {},
  ): DirectoryRecord => ({
    ...base(enrollNo),
    ...over,
  });
  function base(enrollNo: string): DirectoryRecord {
    return {
      enrollNo,
      fullName: "Ann Perera",
      branch: "student",
      groupName: "Form 1",
      tutorInitials: "AP",
      admissionNo: "2024/001",
      displayOrder: null,
    };
  }
  const existing = (
    enrollNo: string,
    over: Partial<ExistingPerson> = {},
  ): ExistingPerson => ({
    id: `id-${enrollNo}`,
    enrollNo,
    fullName: "Ann Perera",
    groupName: "Form 1",
    tutorInitials: "AP",
    admissionNo: "2024/001",
    displayOrder: null,
    isActive: true,
    ...over,
  });

  it("creates people who are not in the directory yet", () => {
    const plan = planImport([record("11007")], [], []);
    expect(plan.creates).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
    expect(plan.deactivates).toHaveLength(0);
  });

  it("updates rather than duplicating when the enrolment number matches", () => {
    const plan = planImport(
      [record("11007", { fullName: "Ann R Perera" })],
      [existing("11007")],
      ["AP"],
    );
    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.changes).toEqual([
      { field: "full_name", before: "Ann Perera", after: "Ann R Perera" },
    ]);
  });

  it("counts a row that changes nothing as unchanged", () => {
    const plan = planImport([record("11007")], [existing("11007")], ["AP"]);
    expect(plan.unchangedCount).toBe(1);
    expect(plan.updates).toHaveLength(0);
  });

  it("leaves a group and tutor set by hand alone when the file has none", () => {
    // The readers' export knows no classification for many people; a
    // re-import must not undo what the office has since done.
    const plan = planImport(
      [record("11007", { branch: null, groupName: null, tutorInitials: null })],
      [existing("11007")],
      ["AP"],
    );
    expect(plan.unchangedCount).toBe(1);
    expect(plan.updates).toHaveLength(0);
    expect(plan.ungroupedCount).toBe(1);
  });

  it("reads a place in the list, and leaves one alone when the file has none", () => {
    const { records, problems } = validateDirectoryCsv(
      `${HEADER},display_order
11007,Ann,student,Form 1,,,3
11008,Ben,student,Form 1,,,`,
      GROUPS,
    );
    expect(problems).toEqual([]);
    expect(records.map((r) => r.displayOrder)).toEqual([3, null]);

    const kept = planImport(
      [record("11007", { displayOrder: null })],
      [existing("11007", { displayOrder: 7 })],
      ["AP"],
    );
    expect(kept.unchangedCount).toBe(1);

    const moved = planImport(
      [record("11007", { displayOrder: 2 })],
      [existing("11007", { displayOrder: 7 })],
      ["AP"],
    );
    expect(moved.updates[0]?.changes).toEqual([
      { field: "display_order", before: "7", after: "2" },
    ]);
  });

  it("refuses a place that is not a whole number", () => {
    const { problems } = validateDirectoryCsv(
      `${HEADER},display_order
11007,Ann,student,Form 1,,,first`,
      GROUPS,
    );
    expect(problems[0]?.column).toBe("display_order");
  });

  it("still changes a group the file names differently", () => {
    const plan = planImport(
      [record("11007", { groupName: "Form 2" })],
      [existing("11007")],
      ["AP"],
    );
    expect(plan.updates[0]?.changes).toEqual([
      { field: "group", before: "Form 1", after: "Form 2" },
    ]);
  });

  it("proposes deactivating anyone active but absent from the file", () => {
    const plan = planImport(
      [record("11007")],
      [existing("11007"), existing("11008")],
      ["AP"],
    );
    expect(plan.deactivates).toEqual([
      { personId: "id-11008", enrollNo: "11008", fullName: "Ann Perera" },
    ]);
  });

  it("does not propose deactivating someone already inactive", () => {
    const plan = planImport([], [existing("11008", { isActive: false })], []);
    expect(plan.deactivates).toHaveLength(0);
  });

  it("reactivates someone who reappears in the file", () => {
    const plan = planImport(
      [record("11007")],
      [existing("11007", { isActive: false })],
      ["AP"],
    );
    expect(plan.updates[0]?.changes).toContainEqual({
      field: "is_active",
      before: "false",
      after: "true",
    });
  });

  it("lists tutors that will be created", () => {
    const plan = planImport(
      [
        record("11007", { tutorInitials: "XY" }),
        record("11008", { tutorInitials: "AP" }),
      ],
      [],
      ["AP"],
    );
    expect(plan.newTutorInitials).toEqual(["XY"]);
  });

  describe("the plan hash", () => {
    it("is stable for the same plan", () => {
      const a = planImport([record("11007")], [], []);
      const b = planImport([record("11007")], [], []);
      expect(a.hash).toBe(b.hash);
    });

    it("does not depend on row order", () => {
      const a = planImport([record("11007"), record("11008")], [], []);
      const b = planImport([record("11008"), record("11007")], [], []);
      expect(a.hash).toBe(b.hash);
    });

    it("changes when the directory changes underneath, so a stale confirm is caught", () => {
      const before = planImport([record("11007")], [], []);
      const after = planImport([record("11007")], [existing("11008")], []);
      expect(after.hash).not.toBe(before.hash);
    });

    it("changes when the file changes", () => {
      const a = planImport([record("11007")], [], []);
      const b = planImport(
        [record("11007", { fullName: "Someone Else" })],
        [],
        [],
      );
      expect(a.hash).not.toBe(b.hash);
    });

    it("is computed from the plan alone", () => {
      const plan = planImport([record("11007")], [], []);
      const { hash, ...rest } = plan;
      expect(hashPlan(rest)).toBe(hash);
    });
  });
});
