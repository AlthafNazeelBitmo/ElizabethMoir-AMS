import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { requireSession, type CookieContext } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { Db } from "../db/client.js";
import { BRANCHES, groups, tutors } from "../db/schema/index.js";
import type { SettingsService } from "../settings/service.js";
import { attendanceReportToCsv, personReportToCsv } from "./csv.js";
import type { ReportService } from "./service.js";

export interface ReportRoutesOptions {
  db: Db;
  auth: AuthService;
  cookies: CookieContext;
  reports: ReportService;
  settings: SettingsService;
}

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

const attendanceQuery = z
  .object({
    from: dateString,
    to: dateString,
    branch: z.enum(BRANCHES).optional(),
    group: z.coerce.number().int().optional(),
    tutor: z.coerce.number().int().optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .refine((value) => value.from <= value.to, {
    message: "The start date must not be after the end date.",
    path: ["from"],
  });

const personQuery = z
  .object({
    from: dateString,
    to: dateString,
    format: z.enum(["json", "csv"]).default("json"),
  })
  .refine((value) => value.from <= value.to, {
    message: "The start date must not be after the end date.",
    path: ["from"],
  });

/** A range longer than this is almost certainly a mistake, and is slow. */
const MAX_RANGE_DAYS = 400;

export const reportRoutes: FastifyPluginAsync<ReportRoutesOptions> = async (
  app,
  { db, auth, cookies, reports, settings },
) => {
  const preHandler = [requireSession({ auth, cookies })];

  app.get("/api/reports/attendance", { preHandler }, async (req, reply) => {
    const parsed = attendanceQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_query",
        message: "Check the dates and filters.",
        problems: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      });
    }
    const { from, to, branch, group, tutor, format } = parsed.data;

    if (daysBetween(from, to) > MAX_RANGE_DAYS) {
      return reply.code(400).send({
        error: "range_too_long",
        message: `Choose a range of ${MAX_RANGE_DAYS} days or fewer.`,
      });
    }

    const report = await reports.attendance(req.auth!.role, {
      from,
      to,
      branch,
      groupId: group,
      tutorId: tutor,
    });

    if (format === "json") return reply.send(report);

    // An export leaves the building. It is audited like one.
    await writeAudit(db, req.log, {
      action: "report_export",
      userId: req.auth!.userId,
      entity: "attendance_report",
      after: { from, to, branch, group, tutor, rows: report.rows.length },
      ip: req.ip || null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    const csv = attendanceReportToCsv(report, {
      filtersDescription: await describeFilters(db, { branch, group, tutor }),
      generatedAt: new Date(),
    });

    return reply
      .code(200)
      .header("content-type", "text/csv; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="attendance-${from}-to-${to}.csv"`,
      )
      .header("cache-control", "no-store")
      .send(csv);
  });

  app.get("/api/reports/daily", { preHandler }, async (req, reply) => {
    const parsed = attendanceQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_query",
        message: "Check the dates and filters.",
        problems: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      });
    }
    const { from, to, branch, group, tutor } = parsed.data;
    if (daysBetween(from, to) > MAX_RANGE_DAYS) {
      return reply.code(400).send({
        error: "range_too_long",
        message: `Choose a range of ${MAX_RANGE_DAYS} days or fewer.`,
      });
    }
    const days = await reports.daily(req.auth!.role, {
      from,
      to,
      branch,
      groupId: group,
      tutorId: tutor,
    });
    return reply.send({ from, to, days });
  });

  app.get<{ Params: { id: string } }>(
    "/api/reports/person/:id",
    { preHandler },
    async (req, reply) => {
      const parsed = personQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_query", message: "Give from and to dates." });
      }
      const { from, to, format } = parsed.data;
      if (daysBetween(from, to) > MAX_RANGE_DAYS) {
        return reply.code(400).send({
          error: "range_too_long",
          message: `Choose a range of ${MAX_RANGE_DAYS} days or fewer.`,
        });
      }

      const result = await reports.person(
        req.auth!.role,
        req.params.id,
        from,
        to,
      );
      // 404 rather than 403: a person this role cannot see does not exist
      // as far as it is concerned.
      if (!result) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such person." });
      }
      if (format === "json") return reply.send(result);

      await writeAudit(db, req.log, {
        action: "report_export",
        userId: req.auth!.userId,
        entity: "person_report",
        entityId: result.person.id,
        after: { from, to, days: result.days.length },
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      const csv = personReportToCsv(result, {
        filtersDescription: "One person",
        generatedAt: new Date(),
        timezone: (await settings.get()).timezone,
      });
      // The filename carries the enrolment number, not the name: a file
      // called after a child is the kind of thing that ends up in a search.
      return reply
        .code(200)
        .header("content-type", "text/csv; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="attendance-${result.person.enrollNo}-${from}-to-${to}.csv"`,
        )
        .header("cache-control", "no-store")
        .send(csv);
    },
  );
};

/** Turns filter ids into something a person reading the file will understand. */
async function describeFilters(
  db: Db,
  filters: {
    branch?: string | undefined;
    group?: number | undefined;
    tutor?: number | undefined;
  },
): Promise<string> {
  const parts: string[] = [];
  if (filters.branch)
    parts.push(filters.branch === "staff" ? "Staff" : "Students");
  if (filters.group !== undefined) {
    const [row] = await db
      .select({ name: groups.name })
      .from(groups)
      .where(eq(groups.id, filters.group))
      .limit(1);
    parts.push(`Group: ${row?.name ?? `#${filters.group}`}`);
  }
  if (filters.tutor !== undefined) {
    const [row] = await db
      .select({ initials: tutors.initials })
      .from(tutors)
      .where(eq(tutors.id, filters.tutor))
      .limit(1);
    parts.push(`Tutor: ${row?.initials ?? `#${filters.tutor}`}`);
  }
  return parts.length > 0
    ? `Filters — ${parts.join("; ")}`
    : "No filters applied";
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}
