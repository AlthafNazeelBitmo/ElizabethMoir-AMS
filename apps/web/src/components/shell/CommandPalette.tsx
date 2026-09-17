import { useQuery } from "@tanstack/react-query";
import {
  BarChart3Icon,
  CalendarIcon,
  MoonIcon,
  RadioIcon,
  SettingsIcon,
  SunIcon,
  UserIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatusShape } from "@/components/status.js";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command.js";
import { Avatar } from "@/components/ui/misc.js";
import { ADMIN_SECTIONS } from "./Sidebar.js";
import { fetchAllRegisterRows, type CurrentUser } from "@/lib/api.js";
import { schoolToday } from "@/lib/format.js";
import { useTheme } from "@/lib/theme.js";

/**
 * ⌘K. Type a name or a number and go to that person on the register; type
 * a page and go there. The people come from the same query the register
 * uses, so opening the palette costs nothing when the register is open.
 */
export function CommandPalette({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: CurrentUser;
}) {
  const navigate = useNavigate();
  const [, setTheme] = useTheme();
  const [query, setQuery] = useState("");
  const today = schoolToday();

  const people = useQuery({
    queryKey: ["register", `date=${today}`],
    queryFn: ({ signal }) =>
      fetchAllRegisterRows(new URLSearchParams({ date: today }), signal),
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  // cmdk filters by its own fuzzy match; a wall of 700 names is capped so
  // the first keystroke does not render all of them.
  const matches = (people.data?.rows ?? [])
    .filter((row) => {
      if (query.trim().length < 2) return false;
      const q = query.trim().toLowerCase();
      return (
        row.fullName.toLowerCase().includes(q) ||
        row.enrollNo.toLowerCase().includes(q)
      );
    })
    .slice(0, 8);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <CommandInput
        placeholder="Search people, or jump to a page…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {query.trim().length < 2
            ? "Type a name or an ID."
            : "Nobody by that name or number."}
        </CommandEmpty>

        {matches.length > 0 && (
          <CommandGroup heading="People">
            {matches.map((row) => (
              <CommandItem
                key={row.personId}
                value={`person-${row.personId}`}
                onSelect={() =>
                  go(
                    `/register?date=${today}&person=${row.personId}&q=${encodeURIComponent(row.enrollNo)}`,
                  )
                }
              >
                <Avatar name={row.fullName} size="sm" />
                <span className="truncate">{row.fullName}</span>
                <span className="tabular text-xs text-muted-foreground">
                  {row.enrollNo}
                </span>
                <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                  <StatusShape status={row.status} />
                  {row.groupName}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {query.trim().length < 2 && (
          <>
            <CommandGroup heading="Go to">
              <CommandItem value="register" onSelect={() => go("/register")}>
                <RadioIcon /> Live register
              </CommandItem>
              <CommandItem value="reports" onSelect={() => go("/reports")}>
                <BarChart3Icon /> Reports
              </CommandItem>
              <CommandItem
                value="yesterday"
                onSelect={() => go(`/register?date=${yesterday(today)}`)}
              >
                <CalendarIcon /> Yesterday's register
              </CommandItem>
              {user.role === "full" &&
                ADMIN_SECTIONS.map((section) => (
                  <CommandItem
                    key={section.id}
                    value={`admin-${section.id}`}
                    onSelect={() => go(`/admin/${section.id}`)}
                  >
                    <section.icon /> {section.label}
                    <span className="ml-auto text-xs text-muted-foreground">
                      Admin
                    </span>
                  </CommandItem>
                ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Appearance">
              <CommandItem
                value="theme-light"
                onSelect={() => {
                  setTheme("light");
                  onOpenChange(false);
                }}
              >
                <SunIcon /> Light
              </CommandItem>
              <CommandItem
                value="theme-dark"
                onSelect={() => {
                  setTheme("dark");
                  onOpenChange(false);
                }}
              >
                <MoonIcon /> Dark
              </CommandItem>
              <CommandItem
                value="theme-system"
                onSelect={() => {
                  setTheme("system");
                  onOpenChange(false);
                }}
              >
                <SettingsIcon /> Follow the system
              </CommandItem>
            </CommandGroup>
          </>
        )}
        {query.trim().length >= 2 &&
          matches.length === 0 &&
          people.isPending && (
            <CommandGroup heading="People">
              <CommandItem disabled value="loading">
                <UserIcon /> Loading the register…
              </CommandItem>
            </CommandGroup>
          )}
      </CommandList>
    </CommandDialog>
  );
}

function yesterday(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
