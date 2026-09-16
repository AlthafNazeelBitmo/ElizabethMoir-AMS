import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthService, AuthenticatedSession } from "./service.js";
import { constantTimeEquals, hashToken } from "./tokens.js";

export const SESSION_COOKIE = "ams_session";
export const CSRF_COOKIE = "ams_csrf";
export const CSRF_HEADER = "x-csrf-token";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireSession`. Absent on unauthenticated routes. */
    auth?: AuthenticatedSession;
  }
}

export interface CookieContext {
  /** False only in local development over plain HTTP. */
  secure: boolean;
}

/**
 * The session cookie is `httpOnly` so script cannot read it, and
 * `SameSite=Lax` so it is not sent on cross-site POSTs — which is the first
 * line of CSRF defence, with the token below as the second.
 *
 * No `Max-Age`: it is a session cookie in the browser sense, and the real
 * lifetime is enforced server-side against the sessions table. A cookie that
 * outlives its row is useless; a row that outlives the cookie is harmless.
 */
export function setAuthCookies(
  reply: FastifyReply,
  ctx: CookieContext,
  tokens: { sessionToken: string; csrfToken: string },
): void {
  reply.setCookie(SESSION_COOKIE, tokens.sessionToken, {
    httpOnly: true,
    secure: ctx.secure,
    sameSite: "lax",
    path: "/",
  });
  // Readable by script on purpose: the client must echo it in a header.
  reply.setCookie(CSRF_COOKIE, tokens.csrfToken, {
    httpOnly: false,
    secure: ctx.secure,
    sameSite: "lax",
    path: "/",
  });
}

export function clearAuthCookies(
  reply: FastifyReply,
  ctx: CookieContext,
): void {
  for (const name of [SESSION_COOKIE, CSRF_COOKIE]) {
    reply.clearCookie(name, { path: "/", secure: ctx.secure, sameSite: "lax" });
  }
}

/** Uniform 401. Never says whether the session was missing, expired or revoked. */
export function unauthorized(reply: FastifyReply) {
  return reply
    .code(401)
    .send({ error: "unauthorized", message: "Sign in to continue." });
}

export function forbidden(reply: FastifyReply) {
  return reply
    .code(403)
    .send({
      error: "forbidden",
      message: "This account does not have access to that.",
    });
}

export interface GuardDeps {
  auth: AuthService;
  cookies: CookieContext;
}

/**
 * Requires a valid session. Attaches it to the request.
 *
 * Also enforces CSRF on state-changing methods: the client must echo the
 * readable CSRF cookie in the `X-CSRF-Token` header, and the server compares
 * it against the hash stored on the session row. Binding it to the session
 * means setting cookies alone is not enough to forge a request.
 */
export function requireSession({ auth, cookies }: GuardDeps) {
  return async function guard(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) {
      await unauthorized(reply);
      return;
    }

    const resolved = await auth.resolveSession(token);
    if (!resolved) {
      clearAuthCookies(reply, cookies);
      await unauthorized(reply);
      return;
    }

    if (isStateChanging(req.method)) {
      const presented = headerValue(req.headers[CSRF_HEADER]);
      if (
        !presented ||
        !constantTimeEquals(hashToken(presented), resolved.csrfHash)
      ) {
        req.log.warn(
          { method: req.method },
          "CSRF token missing or mismatched",
        );
        await reply.code(403).send({
          error: "csrf_failed",
          message:
            "Your session could not be verified. Reload the page and try again.",
        });
        return;
      }
    }

    req.auth = resolved.session;
  };
}

/**
 * Requires one of the given roles. Runs after `requireSession`.
 *
 * This is a coarse gate on whole endpoints. It is not how student/staff
 * separation is enforced — that is a branch predicate inside each query, so
 * that no parameter on a permitted endpoint can reach a staff row.
 */
export function requireRole(...allowed: AuthenticatedSession["role"][]) {
  return async function guard(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!req.auth) {
      await unauthorized(reply);
      return;
    }
    if (!allowed.includes(req.auth.role)) {
      req.log.warn({ role: req.auth.role }, "role check refused");
      await forbidden(reply);
      return;
    }
  };
}

function isStateChanging(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function headerValue(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
