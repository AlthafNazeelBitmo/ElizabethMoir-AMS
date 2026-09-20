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
import { useAttentionCounts } from "@/hooks/useAttentionCounts.js";
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

/**
 * The admin screens, in three groups a person can hold in their head: the
 * directory, the readers, and the school itself. The order within each is
 * the order of use.
 */
export const ADMIN_GROUPS: ReadonlyArray<{
  label: string;
  sections: ReadonlyArray<{
    id: string;
    label: string;
    icon: LucideIcon;
    /** Which attention count, if any, sits beside the entry. */
    count?: "unknown" | "failures";
  }>;
}> = [
  {
    label: "Directory",
    sections: [
      { id: "people", label: "People", icon: UsersIcon },
      { id: "groups", label: "Groups", icon: UsersRoundIcon },
      { id: "unknown", label: "Unknown IDs", icon: IdCardIcon, count: "unknown" },
    ],
  },
  {
    label: "Readers",
    sections: [
      { id: "devices", label: "Devices", icon: ScanLineIcon },
      {
        id: "failures",
        label: "Failed events",
        icon: TriangleAlertIcon,
        count: "failures",
      },
    ],
  },
  {
    label: "School",
    sections: [
      { id: "calendar", label: "Calendar", icon: CalendarDaysIcon },
      { id: "rules", label: "Rules", icon: SettingsIcon },
      { id: "users", label: "Users", icon: KeyRoundIcon },
      { id: "audit", label: "Audit log", icon: ScrollTextIcon },
    ],
  },
];

/** Every admin screen, flat, for the palette and the routes. */
export const ADMIN_SECTIONS = ADMIN_GROUPS.flatMap((g) => g.sections);

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
  const counts = useAttentionCounts(isAdmin);

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

      {/* Admin sub-navigation, only while inside admin: the screens in
          three groups, hung off the Admin entry on a guide line, without
          icons — nine icons in a column is noise, and the words carry it.
          The two screens with work waiting carry their count. */}
      {isAdmin && onAdmin && (
        <nav
          aria-label="Admin sections"
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-y-auto",
            collapsed ? "mt-1 gap-1 px-0" : "mt-1 px-2",
          )}
        >
          {collapsed && <Separator className="mx-3 mb-1 w-auto" />}
          {ADMIN_GROUPS.map((group, index) => (
            <div
              key={group.label}
              className={cn(
                !collapsed && "relative ml-[1.1rem] border-l border-border/80 pl-3",
                !collapsed && index > 0 && "mt-1.5",
                collapsed && index > 0 && "mt-1 border-t border-border/60 pt-1",
              )}
            >
              {!collapsed && (
                <div className="px-2 pt-1.5 pb-1 text-[0.625rem] font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase">
                  {group.label}
                </div>
              )}
              {group.sections.map((section) => {
                const badge =
                  section.count === "unknown"
                    ? counts.unknown
                    : section.count === "failures"
                      ? counts.failures
                      : 0;
                return (
                  <SubNavItem
                    key={section.id}
                    to={`/admin/${section.id}`}
                    icon={section.icon}
                    label={section.label}
                    collapsed={collapsed}
                    badge={badge}
                  />
                );
              })}
            </div>
          ))}
        </nav>
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

/**
 * One admin screen under the Admin entry. Expanded, it is a word on the
 * guide line, the current one marked on the line itself; collapsed, an
 * icon tile with a tooltip, as the main entries are.
 */
function SubNavItem({
  to,
  icon: Icon,
  label,
  collapsed,
  badge,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  collapsed: boolean;
  badge: number;
}) {
  const count =
    badge > 0 ? (
      <span
        className={cn(
          "tabular ml-auto rounded-full px-1.5 py-px text-[0.625rem] font-semibold",
          "bg-muted text-foreground/80 group-aria-[current=page]:bg-primary/15 group-aria-[current=page]:text-primary",
        )}
      >
        {badge > 99 ? "99+" : badge}
      </span>
    ) : null;

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <NavLink
            to={to}
            aria-label={badge > 0 ? `${label} (${badge})` : label}
            className={cn(
              "group relative mx-auto flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
              "aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-[18px] group-aria-[current=page]:text-primary" />
            {badge > 0 && (
              <span
                aria-hidden
                className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary"
              />
            )}
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right">
          {label}
          {badge > 0 ? ` · ${badge}` : ""}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <NavLink
      to={to}
      className={cn(
        "group relative flex h-7 items-center gap-2 rounded-md px-2 text-[0.8125rem] text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
        "aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground",
        // The mark on the guide line, for the screen that is open.
        "before:absolute before:top-1/2 before:-left-[0.875rem] before:size-1.5 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity aria-[current=page]:before:opacity-100",
      )}
    >
      <span className="truncate">{label}</span>
      {count}
    </NavLink>
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

