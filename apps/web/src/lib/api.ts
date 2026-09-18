/**
 * Talking to the API.
 *
 * Sessions are httpOnly cookies, so there is no token to attach and nothing
 * to keep in localStorage. What the client does have to do is echo the CSRF
 * cookie in a header on every state-changing request.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly problems: string[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function csrfToken(): string | null {
  const match = /(?:^|;\s*)ams_csrf=([^;]+)/.exec(document.cookie);
  return match ? decodeURIComponent(match[1]!) : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== "GET" && method !== "HEAD") {
    // The JSON content type only when there is JSON: the server refuses an
    // empty body under that header before the route runs, which is how
    // sign-out and replay — both bodiless — were failing without a trace.
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const token = csrfToken();
    if (token) headers.set("x-csrf-token", token);
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body: unknown = isJson ? await res.json() : null;

  if (res.status === 401) {
    // Usually the session ended: anything the page is showing is now stale,
    // and the honest thing is to say so rather than render a half-empty
    // screen. A refused sign-in is also a 401, and it says why in words
    // written to be read — those words win over the generic line.
    const shaped = (body ?? {}) as { error?: string; message?: string };
    const refusedSignIn = shaped.error === "invalid_credentials" && shaped.message;
    throw new ApiError(
      401,
      shaped.error ?? "unauthorized",
      refusedSignIn ? shaped.message! : "Your session has ended. Sign in again.",
    );
  }

  if (!res.ok) {
    const shaped = (body ?? {}) as {
      error?: string;
      message?: string;
      problems?: unknown;
    };
    throw new ApiError(
      res.status,
      shaped.error ?? "error",
      shaped.message ?? `The request failed (${res.status}).`,
      Array.isArray(shaped.problems) ? shaped.problems.map(String) : [],
    );
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// ── Shapes the API returns ────────────────────────────────────────────────

export type Branch = "student" | "staff";
export type DayStatus =
  "on_site" | "departed" | "late" | "absent" | "not_expected";
export type UserRole = "full" | "student_only";

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  mustChangePassword: boolean;
}

export interface RegisterRow {
  personId: string;
  enrollNo: string;
  fullName: string;
  branch: Branch | null;
  groupId: number | null;
  groupName: string | null;
  tutorInitials: string | null;
  dayRecordId: number | null;
  firstIn: string | null;
  lastOut: string | null;
  status: DayStatus;
  isLate: boolean;
  hasManualEdit: boolean;
  scanCount: number;
}

export interface RegisterPage {
  rows: RegisterRow[];
  nextCursor: string | null;
  total: number;
}

export type StatusCounts = Record<DayStatus | "total" | "late", number>;

export interface GroupCount {
  groupId: number;
  name: string;
  branch: Branch;
  onSite: number;
  total: number;
}

export interface SummaryResponse {
  counts: StatusCounts;
  groups: GroupCount[];
}

export interface PersonDetail {
  id: string;
  enrollNo: string;
  fullName: string;
  admissionNo: string | null;
  photoUrl: string | null;
  isActive: boolean;
  branch: Branch | null;
  groupId: number | null;
  groupName: string | null;
  tutorInitials: string | null;
}

export interface PersonScan {
  id: number;
  attTime: string;
  attTimeLocal: string;
  direction: "in" | "out" | "unknown";
  directionSource: "device" | "status" | "sequence" | "manual";
  deviceSerial: string;
  checkingStatus: string | null;
}

export interface PersonDay {
  id: number;
  date: string;
  firstIn: string | null;
  lastOut: string | null;
  status: DayStatus;
  isLate: boolean;
  scanCount: number;
  hasManualEdit: boolean;
}

export interface Adjustment {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  createdAt: string;
  byName: string | null;
}

/** Fetches every page of the register. The table is virtualised, not paged. */
export async function fetchAllRegisterRows(
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<RegisterPage> {
  const rows: RegisterRow[] = [];
  let cursor: string | null = null;
  let total = 0;
  // A bound, so a mistake cannot spin forever against a large directory.
  for (let page = 0; page < 40; page++) {
    const query = new URLSearchParams(params);
    if (cursor) query.set("cursor", cursor);
    const result: RegisterPage = await api.get<RegisterPage>(
      `/api/register/live?${query.toString()}`,
    );
    rows.push(...result.rows);
    total = result.total;
    cursor = result.nextCursor;
    if (!cursor || signal?.aborted) break;
  }
  return { rows, nextCursor: null, total };
}
