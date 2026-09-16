import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  clearAuthCookies,
  requireSession,
  setAuthCookies,
  unauthorized,
  type CookieContext,
} from "./http.js";
import { MAX_PASSWORD_LENGTH } from "./password.js";
import type { AuthService } from "./service.js";

export interface AuthRoutesOptions {
  auth: AuthService;
  cookies: CookieContext;
}

const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(3).max(320),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/**
 * Authentication endpoints.
 *
 * The failure message is identical for every kind of bad login, so nothing
 * here can be used to discover which email addresses exist.
 */
export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  { auth, cookies },
) => {
  const guard = requireSession({ auth, cookies });

  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      // Deliberately the same message as a wrong password: a validation
      // error must not distinguish "no such address" from "wrong password".
      return reply.code(400).send({
        error: "invalid_credentials",
        message:
          "That email address and password combination was not recognised.",
      });
    }

    const result = await auth.login({
      email: parsed.data.email,
      password: parsed.data.password,
      ip: req.ip || null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    if (!result.ok) {
      if (result.reason === "locked") {
        return reply.code(429).send({
          error: "locked",
          message: "Too many failed attempts. Try again in 15 minutes.",
        });
      }
      return reply.code(401).send({
        error: "invalid_credentials",
        message:
          "That email address and password combination was not recognised.",
      });
    }

    setAuthCookies(reply, cookies, result);
    return reply.code(200).send({
      user: {
        id: result.user.userId,
        email: result.user.email,
        fullName: result.user.fullName,
        role: result.user.role,
        mustChangePassword: result.user.mustChangePassword,
      },
      csrfToken: result.csrfToken,
      expiresAt: result.expiresAt.toISOString(),
    });
  });

  app.post("/api/auth/logout", { preHandler: guard }, async (req, reply) => {
    const session = req.auth;
    if (!session) return unauthorized(reply);
    await auth.logout(
      session.sessionId,
      session.userId,
      req.ip || null,
      req.headers["user-agent"] ?? null,
    );
    clearAuthCookies(reply, cookies);
    return reply.code(200).send({ ok: true });
  });

  app.get("/api/auth/me", { preHandler: guard }, async (req, reply) => {
    const session = req.auth;
    if (!session) return unauthorized(reply);
    return reply.code(200).send({
      user: {
        id: session.userId,
        email: session.email,
        fullName: session.fullName,
        role: session.role,
        mustChangePassword: session.mustChangePassword,
      },
    });
  });

  app.post(
    "/api/auth/change-password",
    { preHandler: guard },
    async (req, reply) => {
      const session = req.auth;
      if (!session) return unauthorized(reply);

      const parsed = changePasswordBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({
            error: "invalid_request",
            message: "Both the current and new password are required.",
          });
      }

      const result = await auth.changePassword({
        userId: session.userId,
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      if (!result.ok) {
        if (result.reason === "weak") {
          return reply.code(422).send({
            error: "weak_password",
            message: "That password cannot be used.",
            problems: result.problems ?? [],
          });
        }
        return reply
          .code(403)
          .send({
            error: "invalid_credentials",
            message: "Your current password was not correct.",
          });
      }

      // Every session was revoked, including this one: sign the browser out.
      clearAuthCookies(reply, cookies);
      return reply
        .code(200)
        .send({
          ok: true,
          message: "Password changed. Sign in again with your new password.",
        });
    },
  );
};
