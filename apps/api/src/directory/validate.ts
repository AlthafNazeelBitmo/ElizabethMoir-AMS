import { BRANCHES, type Branch } from "../db/schema/index.js";
import { readDirectoryCsv, type CsvProblem } from "./csv.js";
import type { DirectoryRecord } from "./provider.js";

/**
 * Turning a spreadsheet into directory records, or into a list of problems
 * that each name a row and say what is wrong with it.
 *
 * The specification is emphatic: validate every row before writing any row,
 * and never report a generic failure. So nothing here stops at the first
 * problem — a person fixing a 600-row export should learn about all of it
 * in one pass, not discover the next error after each re-upload.
 */

export interface KnownGroup {
  id: number;
  name: string;
  branch: Branch;
}

export interface ValidationResult {
  records: DirectoryRecord[];
  problems: CsvProblem[];
}

const MAX_NAME = 200;
const MAX_ENROLL = 64;
const MAX_CATEGORY = 60;

export function validateDirectoryCsv(
  text: string,
  groups: readonly KnownGroup[],
): ValidationResult {
  const { rows, problems: fileProblems } = readDirectoryCsv(text);
  const problems: CsvProblem[] = [...fileProblems];
  if (rows.length === 0) {
    if (problems.length === 0) {
      problems.push({
        lineNumber: null,
        column: null,
        message: "The file has a header but no rows.",
      });
    }
    return { records: [], problems };
  }

  // Group names are matched case- and space-insensitively: a spreadsheet
  // will say "form 1" or "Form  1" and meaning it differently is unlikely.
  const groupsByName = new Map(groups.map((g) => [normalise(g.name), g]));
  const records: DirectoryRecord[] = [];
  const seenEnrollNos = new Map<string, number>();

  for (const row of rows) {
    const line = row.lineNumber;
    const enrollNo = row.values.enroll_no;
    const fullName = row.values.full_name;
    const branchRaw = row.values.branch.toLowerCase();
    const groupName = row.values.group;
    const tutorInitials = row.values.tutor_initials;
    const admissionNo = row.values.admission_no;
    const displayOrderRaw = row.values.display_order;
    const category = row.values.category;

    let rowOk = true;
    const fail = (column: CsvProblem["column"], message: string) => {
      problems.push({ lineNumber: line, column, message });
      rowOk = false;
    };

    if (enrollNo === "") {
      fail("enroll_no", "enroll_no is required.");
    } else if (enrollNo.length > MAX_ENROLL) {
      fail("enroll_no", `enroll_no is longer than ${MAX_ENROLL} characters.`);
    } else if (/\s/.test(enrollNo)) {
      fail(
        "enroll_no",
        `enroll_no "${enrollNo}" contains a space. It must match the reader exactly.`,
      );
    } else {
      const firstSeen = seenEnrollNos.get(enrollNo);
      if (firstSeen !== undefined) {
        fail(
          "enroll_no",
          `enroll_no "${enrollNo}" also appears on line ${firstSeen}.`,
        );
      } else {
        seenEnrollNos.set(enrollNo, line);
      }
    }

    if (fullName === "") fail("full_name", "full_name is required.");
    else if (fullName.length > MAX_NAME) {
      fail("full_name", `full_name is longer than ${MAX_NAME} characters.`);
    }

    // A group may be left blank: an export from the readers often carries
    // people nobody has classified yet, and a name in the directory is
    // worth more than a number under Unknown IDs. Such a person is in no
    // group and expected nowhere until the office sets one. A group that is
    // named must exist, and must agree with the branch.
    let group: KnownGroup | undefined;
    const ungrouped = groupName === "";
    if (!ungrouped) {
      group = groupsByName.get(normalise(groupName));
      if (!group) {
        fail(
          "group",
          `group "${groupName}" does not exist. Create it in Admin first, or correct the spelling. Known groups: ${groups
            .map((g) => g.name)
            .join(", ")}.`,
        );
      }
    }

    if (branchRaw === "") {
      if (!ungrouped)
        fail("branch", `branch is required. Use one of: ${BRANCHES.join(", ")}.`);
    } else if (!isBranch(branchRaw)) {
      fail(
        "branch",
        `branch "${row.values.branch}" is not valid. Use one of: ${BRANCHES.join(", ")}.`,
      );
    }

    // A row whose branch and group disagree is the mistake most likely to
    // put a member of staff in front of a student-only account, so it is an
    // error rather than something to reconcile silently.
    if (group && isBranch(branchRaw) && group.branch !== branchRaw) {
      fail(
        "group",
        `group "${group.name}" is in the ${group.branch} branch, but the row says ${branchRaw}.`,
      );
    }

    if (tutorInitials !== "" && tutorInitials.length > 16) {
      fail("tutor_initials", "tutor_initials is longer than 16 characters.");
    }
    if (admissionNo !== "" && admissionNo.length > 64) {
      fail("admission_no", "admission_no is longer than 64 characters.");
    }
    let displayOrder: number | null = null;
    if (displayOrderRaw !== "") {
      if (!/^\d{1,6}$/.test(displayOrderRaw)) {
        fail(
          "display_order",
          `display_order "${displayOrderRaw}" is not a whole number. It is the person's place in their group's list.`,
        );
      } else {
        displayOrder = Number(displayOrderRaw);
      }
    }

    if (category.length > MAX_CATEGORY) {
      fail("category", `category is longer than ${MAX_CATEGORY} characters.`);
    }

    if (!rowOk) continue;

    records.push({
      enrollNo,
      fullName,
      branch: group ? group.branch : isBranch(branchRaw) ? branchRaw : null,
      groupName: group ? group.name : null,
      tutorInitials: tutorInitials === "" ? null : tutorInitials,
      admissionNo: admissionNo === "" ? null : admissionNo,
      displayOrder,
      category: category === "" ? null : category,
    });
  }

  return { records, problems };
}

function isBranch(v: string): v is Branch {
  return (BRANCHES as readonly string[]).includes(v);
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
