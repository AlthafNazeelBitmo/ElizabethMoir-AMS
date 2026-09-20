import {
  BarChart3Icon,
  CalendarDaysIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  IdCardIcon,
  KeyRoundIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  RadioIcon,
  ScanLineIcon,
  ScrollTextIcon,
  SettingsIcon,
  SunIcon,
  TriangleAlertIcon,
  UsersIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BrandMark, SchoolLogo } from "./BrandMark.js";
import { Avatar, Separator } from "@/components/ui/misc.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { api, type CurrentUser } from "@/lib/api.js";
import { schoolLogoVersion } from "@/lib/format.js";
import { useTheme, type Theme } from "@/lib/theme.js";
import { cn } from "@/lib/utils.js";

/**
 * The left rail. Two things live here: where you can go, and who you are.
 *
 * Hiding navigation is a convenience, never a control — every route is
 * enforced server-side as well. A student-only account is not shown the
 * Admin group at all.
 */

export const ADMIN_SECTIONS: ReadonlyArray<{
  id: string;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "people", label: "People", icon: UsersIcon },
  { id: "groups", label: "Groups", icon: UsersRoundIcon },
  { id: "unknown", label: "Unknown IDs", icon: IdCardIcon },
  { id: "devices", label: "Devices", icon: ScanLineIcon },
  { id: "calendar", label: "Calendar", icon: CalendarDaysIcon },
  { id: "rules", label: "Rules", icon: SettingsIcon },
  { id: "users", label: "Users", icon: KeyRoundIcon },
  { id: "audit", label: "Audit log", icon: ScrollTextIcon },
  { id: "failures", label: "Failed events", icon: TriangleAlertIcon },
];

export function Sidebar({
  user,
  collapsed,
  onToggle,
  onOpenSearch,
}: {
  user: CurrentUser;
  collapsed: boolean;
  onToggle: () => void;
  onOpenSearch: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const isAdmin = user.role === "full";
  const onAdmin = location.pathname.startsWith("/admin");

  const signOut = async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      queryClient.clear();
      navigate("/login", { replace: true });
    }
  };

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "flex h-full shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 print:hidden",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Brand: the whole logo when there is room, the monogram when not. */}
      {collapsed ? (
        <div className="flex h-14 items-center justify-center">
          <BrandMark key={schoolLogoVersion() ?? "none"} size="lg" />
        </div>
      ) : (
        <div className="px-4 pt-4 pb-2">
          <SchoolLogo
            key={schoolLogoVersion() ?? "none"}
            className="h-[5.25rem] w-full"
          />
        </div>
      )}

      {/* Search trigger */}
      <div className={cn("px-2 pb-2", collapsed && "px-0 pb-1")}>
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search"
          className={cn(
            "flex items-center gap-2 rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
            collapsed
              ? "mx-auto size-10 justify-center"
              : "h-8 w-full border bg-card px-2 shadow-xs dark:bg-input/20",
          )}
        >
          <SearchGlyph />
          {!collapsed && <span className="flex-1 text-left">Search…</span>}
        </button>
      </div>

      {/* Navigation */}
      <nav
        aria-label="Main"
        className={cn(
          "flex flex-col gap-0.5 px-2",
          collapsed && "items-stretch gap-1 px-0",
        )}
      >
        <NavItem
          to="/register"
          icon={RadioIcon}
          label="Live register"
          collapsed={collapsed}
        />
        <NavItem
          to="/reports"
          icon={BarChart3Icon}
          label="Reports"
          collapsed={collapsed}
        />
        {isAdmin && (
          <NavItem
            to="/admin/people"
            icon={SettingsIcon}
            label="Admin"
            collapsed={collapsed}
            isActive={onAdmin}
          />
        )}
      </nav>

      {/* Admin sub-navigation, only while inside admin. */}
      {isAdmin && onAdmin && (
        <>
          <Separator className="mx-3 my-2 w-auto" />
          <nav
            aria-label="Admin sections"
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2",
              collapsed && "gap-1 px-0",
            )}
          >
            {!collapsed && (
              <div className="px-2 pt-1 pb-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
                Administration
              </div>
            )}
            {ADMIN_SECTIONS.map((section) => (
              <NavItem
                key={section.id}
                to={`/admin/${section.id}`}
                icon={section.icon}
                label={section.label}
                collapsed={collapsed}
                size="sm"
              />
            ))}
          </nav>
        </>
      )}

      <div className="mt-auto" />

      {/* Collapse toggle. The button is inline-flex, so the rail centres
          it with a flex parent rather than a margin it would ignore. */}
      <div
        className={cn("px-2 pb-1", collapsed && "flex justify-center px-0")}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "w-full justify-start text-muted-foreground",
            collapsed && "size-10 w-10 justify-center px-0",
          )}
        >
          {collapsed ? <ChevronsRightIcon /> : <ChevronsLeftIcon />}
          {!collapsed && "Collapse"}
        </Button>
      </div>

      {/* Account */}
      <div className={cn("border-t p-2", collapsed && "px-0 py-2")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className={cn(
                "flex items-center gap-2.5 rounded-md text-left transition-colors hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent",
                collapsed
                  ? "mx-auto size-10 justify-center"
                  : "w-full px-1.5 py-1.5",
              )}
            >
              <Avatar name={user.fullName} />
              {!collapsed && (
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-sm font-medium">
                    {user.fullName}
                  </div>
                  <div className="truncate text-[0.6875rem] text-muted-foreground">
                    {user.role === "full" ? "Administrator" : "Students only"}
                  </div>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align={collapsed ? "start" : "end"}
            className="w-56"
          >
            <DropdownMenuLabel className="font-normal">
              <div className="text-sm font-medium text-foreground">
                {user.fullName}
              </div>
              <div className="truncate text-xs">{user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <ThemeItems />
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate("/change-password")}>
              <KeyRoundIcon /> Change password
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOutIcon /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
  collapsed,
  isActive: forceActive,
  size = "default",
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  collapsed: boolean;
  isActive?: boolean;
  size?: "default" | "sm";
}) {
  // The class list is a plain string, never NavLink's function form: when
  // the rail is collapsed the link sits inside a tooltip trigger, whose
  // Slot joins class lists as strings and would turn a function into
  // nonsense. The active state comes from aria-current, which NavLink sets,
  // or data-active for a section whose sub-pages share it.
  const link = (
    <NavLink
      to={to}
      aria-label={collapsed ? label : undefined}
      data-active={forceActive || undefined}
      className={cn(
        "group flex items-center gap-2.5 rounded-md text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
        "aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground data-[active]:bg-sidebar-accent data-[active]:text-sidebar-accent-foreground",
        collapsed
          ? "mx-auto size-10 justify-center"
          : size === "sm"
            ? "h-7 px-2"
            : "h-8 px-2",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0 group-aria-[current=page]:text-primary group-data-[active]:text-primary",
          collapsed && "size-[18px]",
        )}
      />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function ThemeItems() {
  const [theme, setTheme] = useTheme();
  const options: Array<{ value: Theme; label: string; icon: LucideIcon }> = [
    { value: "light", label: "Light", icon: SunIcon },
    { value: "dark", label: "Dark", icon: MoonIcon },
    { value: "system", label: "System", icon: MonitorIcon },
  ];
  return (
    <>
      <DropdownMenuLabel>Appearance</DropdownMenuLabel>
      {options.map((option) => (
        <DropdownMenuItem
          key={option.value}
          onSelect={(e) => {
            e.preventDefault();
            setTheme(option.value);
          }}
          className={cn(theme === option.value && "bg-accent")}
        >
          <option.icon />
          {option.label}
          {theme === option.value && (
            <span className="ml-auto text-xs text-muted-foreground">✓</span>
          )}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function SearchGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

