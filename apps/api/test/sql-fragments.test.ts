import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A raw `sql` fragment does not map the values put into it.
 *
 * Column values go through the query builder's type mapping; a value
 * inside a hand-written fragment does not, and the production driver has
 * its own Date handling switched off by the builder. So a bare Date in a
 * fragment reaches the wire untranslated and the statement fails — in
 * production only, because the test database's driver serialises Dates
 * itself. That is how the unknown-card upsert failed on the first real
 * deployment while every test passed.
 *
 * This test reads the source and allows a fragment to interpolate only a
 * column reference, `sql.raw(...)`, a nested fragment, or a value that is
 * unmistakably text already. Anything else is a bug waiting for a driver.
 */

const SRC = join(__dirname, "..", "src");

function* tsFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* tsFiles(path);
    else if (name.endsWith(".ts")) yield path;
  }
}

const FRAGMENT = /sql(?:<[^>]*>)?`((?:[^`\\]|\\.)*)`/gs;
const INTERPOLATION = /\$\{([^}]+)\}/g;

const allowed = [
  /^[A-Za-z_]+\.[A-Za-z_]+$/, // a column: table.column
  /^sql\.raw\(/, // text the caller has already made safe
  /^sql`/, // a nested fragment
  /\.toISOString\(\)$/, // a Date, made text
  /^String\(/, // anything, made text
  /^"[^"]*"$|^'[^']*'$/, // a literal
];

describe("raw sql fragments", () => {
  it("interpolate only columns, raw text, nested fragments or values already made text", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const fragment of source.matchAll(FRAGMENT)) {
        for (const match of fragment[1]!.matchAll(INTERPOLATION)) {
          const expression = match[1]!.trim();
          if (allowed.some((rule) => rule.test(expression))) continue;
          offenders.push(`${relative(SRC, file)}: \${${expression}}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
