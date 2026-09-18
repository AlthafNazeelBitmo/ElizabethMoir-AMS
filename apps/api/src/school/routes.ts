import type { FastifyPluginAsync } from "fastify";
import { requireSession, type CookieContext } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { SettingsService } from "../settings/service.js";
import { readLogo } from "./logo.js";

export interface SchoolRoutesOptions {
  auth: AuthService;
  cookies: CookieContext;
  settings: SettingsService;
}

/**
 * What every signed-in screen needs to know about the school before it
 * renders anything: its name, for headings and printed reports, and its
 * timezone, so every time on screen reads as the school's clock and not the
 * viewer's. Both are settings, so both come from here rather than from a
 * constant that would drift from what the administrator set.
 *
 * Readable by any session. The attendance rules themselves stay behind the
 * administrator role.
 */
export const schoolRoutes: FastifyPluginAsync<SchoolRoutesOptions> = async (
  app,
  { auth, cookies, settings },
) => {
  app.get(
    "/api/school",
    { preHandler: [requireSession({ auth, cookies })] },
    async (_req, reply) => {
      const current = await settings.get();
      const logo = await readLogo(settings);
      return reply.header("cache-control", "no-store").send({
        name: current.schoolName,
        timezone: current.timezone,
        logoVersion: logo?.version ?? null,
      });
    },
  );

  // The mark itself needs no session: it is on the sign-in page, and it is
  // the school's public crest, not a record about anyone.
  app.get("/api/school/logo", async (req, reply) => {
    const logo = await readLogo(settings);
    if (!logo) {
      return reply
        .code(404)
        .header("cache-control", "no-store")
        .send({ error: "not_found", message: "No mark has been uploaded." });
    }
    const etag = `"${logo.version}"`;
    if (req.headers["if-none-match"] === etag) {
      return reply.code(304).header("etag", etag).send();
    }
    return reply
      .header("content-type", logo.mime)
      .header("etag", etag)
      .header("cache-control", "public, max-age=300")
      .send(logo.bytes);
  });
};
