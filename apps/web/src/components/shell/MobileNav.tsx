import {
  BarChart3Icon,
  KeyRoundIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  RadioIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Avatar } from "@/components/ui/misc.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { api, type CurrentUser } from "@/lib/api.js";
import { useTheme, type Theme } from "@/lib/theme.js";
import { cn } from "@/lib/utils.js";

/**
 * The phone's navigation: a bar along the bottom, where a thumb is. The
 * sidebar is not shown at this width at all — a rail of icons down the
 * left of a phone is a desktop habit, not a phone design.
 */
export function MobileNav({
  user,
  onOpenSearch,
}: {
  user: CurrentUser;
  onOpenSearch: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useTheme();

  const signOut = async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      navigate("/login", { replace: true });
    }
  };

  const themes: Array<{ value: Theme; label: string; icon: LucideIcon }> = [
    { value: "light", label: "Light", icon: SunIcon },
    { value: "dark", label: "Dark", icon: MoonIcon },
    { value: "system", label: "System", icon: MonitorIcon },
  ];

  return (
    <nav
      aria-label="Main"
      className="flex shrink-0 items-stretch border-t bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground"
    >
      <Tab to="/register" icon={RadioIcon} label="Register" />
      <Tab to="/reports" icon={BarChart3Icon} label="Reports" />
      <button
        type="button"
        onClick={onOpenSearch}
        className="flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[0.6875rem] font-medium text-muted-foreground"
      >
        <SearchIcon className="size-5" />
        Search
      </button>
      {user.role === "full" && (
        <Tab
          to="/admin/people"
          icon={SettingsIcon}
          label="Admin"
          isActive={location.pathname.startsWith("/admin")}
        />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className="flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[0.6875rem] font-medium text-muted-foreground data-[state=open]:text-foreground"
          >
            <Avatar
              name={user.fullName}
              size="sm"
              className="size-5 text-[0.5rem]"
            />
            Account
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="text-sm font-medium text-foreground">
              {user.fullName}
            </div>
            <div className="truncate text-xs">{user.email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          {themes.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={(e) => {
                e.preventDefault();
                setTheme(option.value);
              }}
              className={cn(theme === option.value && "bg-accent")}
            >
              <option.icon /> {option.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate("/change-password")}>
            <KeyRoundIcon /> Change password
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOutIcon /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}

function Tab({
  to,
  icon: Icon,
  label,
  isActive: forceActive,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  isActive?: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[0.6875rem] font-medium transition-colors",
          (forceActive ?? isActive) ? "text-primary" : "text-muted-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "flex h-6 w-10 items-center justify-center rounded-full transition-colors",
              (forceActive ?? isActive) && "bg-accent",
            )}
          >
            <Icon className="size-5" />
          </span>
          {label}
        </>
      )}
    </NavLink>
  );
}
