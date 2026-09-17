import { useQuery } from "@tanstack/react-query";
import {
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useEffect } from "react";
import { api, ApiError, type CurrentUser } from "./lib/api.js";
import {
  configureSchool,
  schoolName,
  type SchoolProfile,
} from "./lib/format.js";
import { Button } from "./components/primitives.js";

/**
 * The shell: identity, the top-level navigation, and the rule that a
 * `student_only` account sees no staff navigation and no admin section.
 *
 * Hiding navigation is a convenience, never a control — every one of these
 * routes is enforced server-side as well.
 */
export function App() {
  const location = useLocation();
  const navigate = useNavigate();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: CurrentUser }>("/api/auth/me"),
    retry: false,
  });

  // The school's name and timezone, before anything that formats a time
  // renders. Every page reads them through `format.ts`, so this is loaded
  // once here rather than by each page in turn.
  const school = useQuery({
    queryKey: ["school"],
    queryFn: () => api.get<SchoolProfile>("/api/school"),
    enabled: !!data,
    staleTime: 5 * 60_000,
  });
  // Applied during render, deliberately: the gate below keeps every child
  // unrendered until this has run, so no page ever formats a time with the
  // fallback and then re-renders with the real zone.
  if (school.data) configureSchool(school.data);

  useEffect(() => {
    if (school.data) document.title = `${schoolName()} — Attendance`;
  }, [school.data]);

  if (isPending || (data && school.isPending)) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-500">Checking your session…</p>
      </div>
    );
  }

  if (isError || school.isError) {
    const failure = isError ? error : school.error;
    const unauthorised = failure instanceof ApiError && failure.status === 401;
    if (unauthorised)
      return (
        <Navigate to="/login" replace state={{ from: location.pathname }} />
      );
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="text-sm text-neutral-700">
          The server could not be reached. Check your connection and reload.
        </p>
      </div>
    );
  }

  const user = data!.user;

  // A forced password change blocks everything else, deliberately.
  if (user.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  const isAdmin = user.role === "full";

  const signOut = async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      navigate("/login", { replace: true });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-6 border-b border-neutral-200 bg-white px-4 py-2">
        <span className="text-sm font-semibold tracking-tight text-brand-700">
          {schoolName()}
        </span>

        <nav className="flex items-center gap-1" aria-label="Main">
          <TopLink to="/register">Live register</TopLink>
          <TopLink to="/reports">Reports</TopLink>
          {/* No admin link at all for a student-only account. */}
          {isAdmin && <TopLink to="/admin">Admin</TopLink>}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs text-neutral-500 sm:inline">
            {user.fullName}
            {user.role === "student_only" && " · students only"}
          </span>
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <Outlet context={user} />
      </main>
    </div>
  );
}

function TopLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded px-2.5 py-1.5 text-sm font-medium transition-colors ${
          isActive
            ? "bg-brand-50 text-brand-700"
            : "text-neutral-600 hover:bg-neutral-100"
        }`
      }
    >
      {children}
    </NavLink>
  );
}
