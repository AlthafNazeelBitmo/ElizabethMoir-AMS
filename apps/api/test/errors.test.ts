import { describe, expect, it } from "vitest";
import { describeError } from "../src/errors.js";

/**
 * A database failure reaches the log wrapped: Drizzle says which query
 * failed and keeps the driver's reason in `cause`. The morning the
 * school's register went down, the log said only "Failed query: select
 * …" — true, and no use to anybody.
 */

describe("describeError", () => {
  it("carries the reason out of the cause, with the code", () => {
    const driver = Object.assign(
      new Error("password authentication failed for user 'ams'"),
      { code: "28P01", severity: "FATAL", routine: "auth_failed" },
    );
    const wrapper = new Error('Failed query: select "key" from "settings"', {
      cause: driver,
    });

    expect(describeError(wrapper)).toMatchObject({
      name: "Error",
      message: 'Failed query: select "key" from "settings"',
      cause: "password authentication failed for user 'ams'",
      code: "28P01",
      severity: "FATAL",
      routine: "auth_failed",
    });
  });

  it("keeps the query and drops the values bound to it", () => {
    // Specification §9: no names and no enrolment numbers in the logs.
    const wrapper = new Error(
      'Failed query: insert into "scans" ("enroll_no") values ($1)\nparams: 11007,Ann Perera',
    );
    const described = describeError(wrapper);
    expect(described.message).toBe(
      'Failed query: insert into "scans" ("enroll_no") values ($1)\nparams: [omitted]',
    );
    expect(described.message).not.toContain("Ann Perera");
    expect(described.message).not.toContain("11007");
  });

  it("follows a chain of causes to the one that knows", () => {
    const root = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const middle = new Error("pool acquire failed", { cause: root });
    const top = new Error("Failed query: select 1", { cause: middle });
    expect(describeError(top)).toMatchObject({
      cause: "connect ECONNREFUSED",
      code: "ECONNREFUSED",
    });
  });

  it("describes something that is not an error at all", () => {
    expect(describeError("boom")).toEqual({
      name: "UnknownError",
      message: "boom",
    });
  });

  it("says nothing about a cause when there is none", () => {
    const plain = new Error("ordinary");
    expect(describeError(plain).cause).toBeUndefined();
  });
});
