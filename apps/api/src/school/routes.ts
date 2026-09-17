import type { FastifyPluginAsync } from "fastify";
import { requireSession, type CookieContext } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { SettingsService } from "../settings/service.js";

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
      return reply
        .header("cache-control", "no-store")
        .send({ name: current.schoolName, timezone: current.timezone });
    },
  );
};
