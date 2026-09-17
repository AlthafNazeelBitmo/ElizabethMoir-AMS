import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { CommandPalette } from "@/components/shell/CommandPalette.js";
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
  // A phone gets the icon rail whatever was chosen on a desk.
  const narrow = useNarrowViewport();

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
      <div className="flex h-full">
        <Sidebar
          user={user}
          collapsed={collapsed || narrow}
          onToggle={toggleSidebar}
          onOpenSearch={() => setPaletteOpen(true)}
        />
        <main className="min-h-0 min-w-0 flex-1">
          <Outlet context={user} />
        </main>
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

function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 1023px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** The shape of the shell while the session is checked; never a spinner. */
function ShellSkeleton() {
  return (
    <div className="flex h-full" aria-busy>
      <div className="flex w-60 flex-col gap-3 border-r bg-sidebar p-3">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-3.5 w-28" />
        </div>
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
