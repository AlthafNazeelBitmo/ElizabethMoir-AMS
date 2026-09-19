import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { CommandPalette } from "@/components/shell/CommandPalette.js";
import { MobileNav } from "@/components/shell/MobileNav.js";
import { Sidebar } from "@/components/shell/Sidebar.js";
import { ErrorState } from "@/components/states.js";
import { Skeleton } from "@/components/ui/misc.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { api, ApiError, type CurrentUser } from "@/lib/api.js";
import {
  configureSchool,
  schoolName,
  type SchoolProfile,
} from "@/lib/format.js";
import { resolvedTheme, useTheme } from "@/lib/theme.js";

/**
 * The shell: identity, the school profile, the sidebar, the palette.
 *
 * Nothing inside renders until the session and the school profile are both
 * known, so no page ever formats a time with the wrong zone or prints a
 * report with the wrong name.
 */

const SIDEBAR_KEY = "ams.sidebar";

export function App() {
  const location = useLocation();

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: CurrentUser }>("/api/auth/me"),
    retry: false,
  });

  const school = useQuery({
    queryKey: ["school"],
    queryFn: () => api.get<SchoolProfile>("/api/school"),
    enabled: !!me.data,
    staleTime: 5 * 60_000,
  });
  // Applied during render, deliberately: the gate below keeps every child
  // unrendered until this has run.
  if (school.data) configureSchool(school.data);

  useEffect(() => {
    if (school.data) document.title = `${schoolName()} — Attendance`;
  }, [school.data]);

  if (me.isPending || (me.data && school.isPending)) {
    return <ShellSkeleton />;
  }

  if (me.isError || school.isError) {
    const failure = me.isError ? me.error : school.error;
    if (failure instanceof ApiError && failure.status === 401) {
      return (
        <Navigate to="/login" replace state={{ from: location.pathname }} />
      );
    }
    return (
      <div className="flex h-full items-center justify-center">
        <ErrorState
          title="The server could not be reached."
          detail="Check the connection and reload the page."
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  const user = me.data!.user;

  // A forced password change blocks everything else, deliberately.
  if (user.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  return <Shell user={user} />;
}

function Shell({ user }: { user: CurrentUser }) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
    } catch {
      return false;
    }
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [theme] = useTheme();
  // A tablet gets the icon rail whatever was chosen on a desk; a phone gets
  // a bar along the bottom and no sidebar at all.
  const narrow = useMediaQuery("(max-width: 1023px)");
  const phone = useMediaQuery("(max-width: 767px)");
  const location = useLocation();

  const toggleSidebar = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "open");
      } catch {
        // Not remembered; still applies now.
      }
      return next;
    });
  }, []);

  // ⌘K / Ctrl+K opens the palette from anywhere; "/" focuses a page's own
  // search box where it has one (the register handles that itself).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col md:flex-row">
        {!phone && (
          <Sidebar
            user={user}
            collapsed={collapsed || narrow}
            onToggle={toggleSidebar}
            onOpenSearch={() => setPaletteOpen(true)}
          />
        )}
        <main className="min-h-0 min-w-0 flex-1 print:overflow-visible">
          {/* Keyed on the path so a new page fades in; 150ms, nothing more. */}
          <div
            key={location.pathname}
            className="h-full animate-in fade-in-0 duration-150 print:h-auto"
          >
            <Outlet context={user} />
          </div>
        </main>
        {phone && (
          <MobileNav user={user} onOpenSearch={() => setPaletteOpen(true)} />
        )}
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        user={user}
      />
      <Toaster
        position="bottom-right"
        theme={resolvedTheme(theme)}
        richColors={false}
        closeButton
        toastOptions={{
          classNames: {
            toast:
              "!rounded-lg !border !bg-popover !text-popover-foreground !shadow-lg",
            description: "!text-muted-foreground",
          },
        }}
      />
    </TooltipProvider>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** The shape of the shell while the session is checked; never a spinner. */
function ShellSkeleton() {
  return (
    <div className="flex h-full" aria-busy>
      <div className="flex w-60 flex-col gap-3 border-r bg-sidebar p-3">
        <Skeleton className="mx-1 mt-1 h-[5.25rem]" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-full" />
      </div>
      <div className="flex-1 p-6">
        <Skeleton className="h-6 w-48" />
        <div className="mt-6 grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="mt-6 h-96 w-full" />
      </div>
    </div>
  );
}
