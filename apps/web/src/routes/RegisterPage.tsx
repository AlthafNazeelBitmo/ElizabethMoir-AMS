import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { PrintHeader } from "@/components/PrintHeader.js";
import { AttentionStrip } from "@/components/register/AttentionStrip.js";
import { GroupsPanel } from "@/components/register/GroupsPanel.js";
import { RegisterPrintSheet } from "@/components/register/RegisterPrintSheet.js";
import { PersonSheet } from "@/components/register/PersonSheet.js";
import {
  RegisterCards,
  RegisterTable,
} from "@/components/register/RegisterTable.js";
import { StatCards } from "@/components/register/StatCards.js";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  TableSkeleton,
} from "@/components/states.js";
import { Button } from "@/components/ui/button.js";
import { Input, NativeSelect } from "@/components/ui/input.js";
import {
  useRegisterStream,
  type ConnectionState,
  type ScanEventPayload,
} from "@/hooks/useRegisterStream.js";
import {
  fetchAllRegisterRows,
  api,
  type CurrentUser,
  type RegisterRow,
  type SummaryResponse,
} from "@/lib/api.js";
import {
  DEFAULT_SORT,
  DEFAULT_STATUS,
  filtersFromSearch,
  hasActiveFilters,
  matchesStatus,
  orderRows,
  queryFromFilters,
  searchFromFilters,
  type RegisterFilters,
  type SortOrder,
  type StatusFilter,
} from "@/lib/filters.js";
import {
  formatDate,
  formatTime,
  schoolName,
  schoolToday,
  STATUS_PRESENTATION,
} from "@/lib/format.js";
import { usePrintSetup } from "@/lib/print.js";
import { cn } from "@/lib/utils.js";

/**
 * The live register.
 *
 * This is what somebody has open on a monitor all day, so the rules are
 * strict: the page itself never scrolls, a new scan updates its row
 * without refetching, and the connection state is always visible. Stale
 * data is never shown as though it were live.
 *
 * At rest the list is A–Z by surname, the way a register is read, and a
 * scan changes the row where it stands. "Latest first" makes it a feed of
 * the door instead: whoever last came in or went out is at the top, and a
 * scan moves its row there.
 */
export function RegisterPage() {
  const user = useOutletContext<CurrentUser>();
  const today = schoolToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = filtersFromSearch(searchParams, today);

  // The open person lives in the URL so the palette, a shared link and the
  // back button all reach the same place.
  // Every URL change is derived from the URL as it is at that moment,
  // never from a render's snapshot: React Router hands its updater the
  // params of the last render, so a debounced search firing a tick after a
  // row click would otherwise rewrite the URL without the person just
  // opened. `history.replaceState` is synchronous, so the location is the
  // one source that is never stale.
  const updateSearch = useCallback(
    (mutate: (current: URLSearchParams) => URLSearchParams) => {
      const current = new URLSearchParams(window.location.search);
      setSearchParams(mutate(current), { replace: true });
    },
    [setSearchParams],
  );

  const selectedPersonId = searchParams.get("person");
  const setSelectedPersonId = useCallback(
    (personId: string | null) => {
      updateSearch((current) => {
        const next = new URLSearchParams(current);
        if (personId) next.set("person", personId);
        else next.delete("person");
        return next;
      });
    },
    [updateSearch],
  );

  const [scrollToPersonId, setScrollToPersonId] = useState<string | null>(null);
  const [recentlyChanged, setRecentlyChanged] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [offscreenUpdates, setOffscreenUpdates] = useState<string[]>([]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchDraft, setSearchDraft] = useState(filters.q);

  const setFilters = useCallback(
    (next: Partial<RegisterFilters>) => {
      updateSearch((current) => {
        const before = filtersFromSearch(current, today);
        const merged = { ...before, ...next };
        // A form's codes are its own — DG is Form 1's, LG is Form 2's —
        // so moving to another group or branch drops a category that
        // would find nobody there, rather than emptying the screen.
        const movedGroup =
          ("group" in next && next.group !== before.group) ||
          ("branch" in next && next.branch !== before.branch);
        if (movedGroup && next.category === undefined) merged.category = null;
        const params = searchFromFilters(merged, today);
        const person = current.get("person");
        if (person) params.set("person", person);
        return params;
      });
    },
    [updateSearch, today],
  );

  // Free-text search is debounced by 250ms and applied in the browser: the
  // rows are already here, so typing stays instant and no refetch races the
  // live stream.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchDraft !== filters.q) setFilters({ q: searchDraft });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft, filters.q, setFilters]);
  useEffect(() => {
    setSearchDraft(filters.q);
    // Only when the URL changes underneath us (palette, back button).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q]);

  // "/" focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const serverQuery = queryFromFilters(filters).toString();

  const register = useQuery({
    queryKey: ["register", serverQuery],
    queryFn: ({ signal }) =>
      fetchAllRegisterRows(new URLSearchParams(serverQuery), signal),
  });

  const summary = useQuery({
    queryKey: ["summary", serverQuery],
    queryFn: () =>
      api.get<SummaryResponse>(`/api/register/summary?${serverQuery}`),
  });

  // Rows held locally so a scan can update one in place without refetching
  // and without the table re-sorting under the reader's eyes.
  const [rows, setRows] = useState<RegisterRow[]>([]);
  useEffect(() => {
    if (register.data) setRows(register.data.rows);
  }, [register.data]);

  const applyScan = useCallback(
    (event: ScanEventPayload) => {
      if (event.date !== filters.date) return;
      setRows((current) => {
        const index = current.findIndex((r) => r.personId === event.personId);
        // Someone who was not on screen — a newly attached enrolment, say —
        // is not spliced in mid-view; the next fetch will place them.
        if (index === -1) return current;
        const next = [...current];
        next[index] = { ...next[index]!, ...toRow(event) };
        return next;
      });

      setRecentlyChanged((current) => new Set(current).add(event.personId));
      window.setTimeout(() => {
        setRecentlyChanged((current) => {
          const next = new Set(current);
          next.delete(event.personId);
          return next;
        });
      }, 1600);

      // In a fixed order a change can land anywhere down the list, so it
      // is counted and offered. Latest first, it lands at the top.
      if (filters.sort !== "latest") {
        setOffscreenUpdates((current) =>
          current.includes(event.personId)
            ? current
            : [...current, event.personId],
        );
      }
      void summary.refetch();
    },
    [filters.date, filters.sort, summary],
  );
  useEffect(() => setOffscreenUpdates([]), [filters.sort]);

  const stream = useRegisterStream({
    onScan: applyScan,
    onResync: () => {
      void register.refetch();
      void summary.refetch();
    },
    // Only today can change live; a past date is settled.
    enabled: filters.date === today,
  });

  const visibleRows = useMemo(() => {
    const needle = filters.q.trim().toLowerCase();
    const shown = rows.filter((row) => {
      if (!matchesStatus(row, filters.status)) return false;
      if (!needle) return true;
      return (
        row.fullName.toLowerCase().includes(needle) ||
        row.enrollNo.toLowerCase().includes(needle)
      );
    });
    return orderRows(shown, filters.sort);
  }, [rows, filters.status, filters.sort, filters.q]);

  // The tutor initials are kept off the register for now: the office
  // asked for the screen without them.
  // Print-to-PDF names the file after the document's title.
  usePrintSetup(
    `${schoolName()} — Live register — ${formatDate(filters.date)}`,
  );

  /** What the printed sheet says it covers, so it cannot be mistaken. */
  const printedFilters = useMemo(() => {
    const parts: string[] = [];
    const group = (summary.data?.groups ?? []).find(
      (g) => g.groupId === filters.group,
    );
    if (group) parts.push(group.name);
    else if (filters.group === "none") parts.push("No group");
    else if (filters.branch)
      parts.push(filters.branch === "student" ? "Students" : "Staff");
    else parts.push("Everyone");
    if (filters.category) parts.push(filters.category);
    parts.push(
      filters.status === "any"
        ? "every status"
        : filters.status === "checked_in"
          ? "checked in"
          : STATUS_PRESENTATION[filters.status].label.toLowerCase(),
    );
    if (filters.q.trim()) parts.push(`matching “${filters.q.trim()}”`);
    return parts.join(" · ");
  }, [
    filters.branch,
    filters.category,
    filters.group,
    filters.q,
    filters.status,
    summary.data?.groups,
  ]);

  /**
   * The categories to offer, under their group. Guarded: a server older
   * than this page sends a flat list of names, and a filter is not worth
   * a blank screen.
   */
  const categoryBuckets = (summary.data?.categories ?? []).filter(
    (bucket): bucket is { group: string | null; categories: string[] } =>
      Array.isArray(bucket?.categories),
  );

  const showTutor = false;
  const isNarrow = useIsNarrow();
  const isCompact = useMediaQuery("(max-width: 1023px)");
  const isToday = filters.date === today;

  const shiftDate = (days: number) => {
    const d = new Date(`${filters.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const next = d.toISOString().slice(0, 10);
    if (next <= today) setFilters({ date: next });
  };

  return (
    // On a desk the page never scrolls and the table has its own scroll; on a
    // phone the page scrolls and the list is just a list. A trapped list
    // showing one card at a time is the worst of both.
    <div className="flex flex-col gap-4 overflow-y-auto p-4 md:h-full md:min-h-0 md:overflow-hidden lg:p-5 print:h-auto print:gap-3 print:overflow-visible print:p-0">
      {/* On paper the screen gives way to a sheet that explains itself:
          the header, the day's figures, and every row in view. */}
      <PrintHeader
        title="Live register"
        lines={[
          `${formatDate(filters.date)}${isToday ? " · today" : " · settled day"}`,
          printedFilters,
          `${visibleRows.length} ${visibleRows.length === 1 ? "person" : "people"}`,
        ]}
        preparedBy={user.fullName}
      />
      <RegisterPrintSheet rows={visibleRows} counts={summary.data?.counts} />

      <PageHeader
        className="print:hidden"
        title="Live register"
        description={
          <span className="flex items-center gap-2">
            {formatDate(filters.date)}
            {isToday ? (
              <span className="text-muted-foreground/70">· today</span>
            ) : (
              <span className="rounded-full bg-muted px-1.5 py-px text-[0.6875rem] font-medium text-muted-foreground">
                settled day
              </span>
            )}
          </span>
        }
        actions={
          <>
            <ConnectionIndicator
              state={stream.shown}
              lastContactAt={stream.lastContactAt}
            />
            <div className="flex items-center rounded-md border bg-card shadow-xs dark:bg-input/20">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous day"
                onClick={() => shiftDate(-1)}
              >
                <ChevronLeftIcon />
              </Button>
              <div className="relative">
                <CalendarIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="date"
                  aria-label="Date"
                  className="tabular h-7 w-[9.5rem] border-0 bg-transparent pr-1 pl-7 text-sm outline-none"
                  value={filters.date}
                  max={today}
                  onChange={(e) =>
                    setFilters({ date: e.target.value || today })
                  }
                />
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next day"
                disabled={isToday}
                onClick={() => shiftDate(1)}
              >
                <ChevronRightIcon />
              </Button>
            </div>
            {!isToday && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters({ date: today })}
              >
                Today
              </Button>
            )}
            {/* The browser's own print dialogue, where "Save as PDF" is
                the destination. The sheet it prints is this day's list,
                as filtered, not the dozen rows the table has in view. */}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <DownloadIcon /> Download PDF
            </Button>
          </>
        }
      />

      {/* Only once the stream has been gone long enough to matter: a
          reconnect that lands within seconds is not worth a line. */}
      {stream.shown === "reconnecting" && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground print:hidden"
        >
          <span className="size-1.5 rounded-full bg-status-late" aria-hidden />
          Connection lost — reconnecting. The figures are as of{" "}
          <span className="tabular font-medium text-foreground">
            {stream.lastContactAt
              ? formatTime(stream.lastContactAt.toISOString())
              : "when the page loaded"}
          </span>
          .
        </div>
      )}

      <div className="contents print:hidden">
        <AttentionStrip user={user} />
      </div>

      <StatCards
        counts={summary.data?.counts}
        rows={rows}
        activeStatus={filters.status}
        onSelectStatus={(status) => setFilters({ status })}
        isLoading={summary.isPending}
        className="print:hidden"
      />

      <div className="flex gap-4 md:min-h-0 md:flex-1 print:hidden">
        <GroupsPanel
          groups={summary.data?.groups ?? []}
          ungrouped={summary.data?.ungrouped ?? { checkedIn: 0, total: 0 }}
          activeGroup={filters.group}
          activeBranch={filters.branch}
          canSeeStaff={user.role === "full"}
          onSelect={(branch, group) => setFilters({ branch, group })}
          className="hidden w-56 shrink-0 lg:flex"
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-xs md:min-h-0">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="search"
                className="w-64 pl-8"
                placeholder="Search name or ID"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                aria-label="Search by name or ID"
              />
            </div>

            {/* The rail is hidden on a phone; the same choice, as a select. */}
            <NativeSelect
              aria-label="Group"
              className="lg:hidden"
              value={filters.group ?? (filters.branch ? `branch:${filters.branch}` : "")}
              onChange={(e) => {
                const value = e.target.value;
                if (!value) return setFilters({ branch: null, group: null });
                if (value === "none") return setFilters({ branch: null, group: "none" });
                if (value.startsWith("branch:"))
                  return setFilters({ branch: value.slice(7) as "student" | "staff", group: null });
                const group = (summary.data?.groups ?? []).find((g) => String(g.groupId) === value);
                setFilters({ branch: group?.branch ?? null, group: Number(value) });
              }}
            >
              <option value="">Everyone</option>
              <option value="branch:student">All students</option>
              {(summary.data?.groups ?? [])
                .filter((g) => g.branch === "student")
                .map((g) => (
                  <option key={g.groupId} value={g.groupId}>
                    {g.name}
                  </option>
                ))}
              {user.role === "full" && (
                <>
                  <option value="branch:staff">All staff</option>
                  {(summary.data?.groups ?? [])
                    .filter((g) => g.branch === "staff")
                    .map((g) => (
                      <option key={g.groupId} value={g.groupId}>
                        {g.name}
                      </option>
                    ))}
                  {(summary.data?.ungrouped?.total ?? 0) > 0 && (
                    <option value="none">No group</option>
                  )}
                </>
              )}
            </NativeSelect>

            {/* Each form has its own codes, so the choices are whatever
                the view holds; on a view with none, no select at all. */}
            {categoryBuckets.length > 0 && (
              <NativeSelect
                aria-label="Category"
                value={filters.category ?? ""}
                onChange={(e) =>
                  setFilters({ category: e.target.value || null })
                }
              >
                <option value="">All categories</option>
                {categoryBuckets.map((bucket) => (
                  <optgroup
                    key={bucket.group ?? "none"}
                    label={bucket.group ?? "No group"}
                  >
                    {bucket.categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
            )}

            <NativeSelect
              aria-label="Status"
              value={filters.status}
              onChange={(e) =>
                setFilters({ status: e.target.value as StatusFilter })
              }
            >
              <option value="checked_in">Checked in</option>
              <option value="any">Everyone</option>
              <option value="on_site">Present</option>
              <option value="departed">Departed</option>
              <option value="late">Late</option>
              <option value="pending">Not arrived yet</option>
              <option value="absent">Absent</option>
              <option value="not_expected">Not expected</option>
            </NativeSelect>

            <NativeSelect
              aria-label="Order"
              value={filters.sort}
              onChange={(e) =>
                setFilters({ sort: e.target.value as SortOrder })
              }
            >
              <option value="surname">Surname A–Z</option>
              <option value="latest">Latest first</option>
              <option value="school">School order</option>
            </NativeSelect>

            {hasActiveFilters(filters) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchDraft("");
                  updateSearch(() => searchFromFilters(blankFilters(today), today));
                }}
              >
                <XIcon /> Clear filters
              </Button>
            )}

            <span className="tabular ml-auto text-xs text-muted-foreground">
              {register.isSuccess && (
                <>
                  {visibleRows.length.toLocaleString("en-GB")}
                  {visibleRows.length !== rows.length &&
                    ` of ${rows.length.toLocaleString("en-GB")}`}{" "}
                  {visibleRows.length === 1 ? "person" : "people"}
                </>
              )}
            </span>
          </div>

          {offscreenUpdates.length > 2 && (
            <button
              type="button"
              onClick={() => {
                setScrollToPersonId(offscreenUpdates.at(-1) ?? null);
                setOffscreenUpdates([]);
              }}
              className="mx-3 mt-2 flex shrink-0 items-center gap-1.5 self-start rounded-full border border-primary/30 bg-accent px-3 py-1 text-xs font-medium text-accent-foreground shadow-xs transition-colors hover:bg-accent/70"
            >
              <ArrowDownIcon className="size-3" />
              {offscreenUpdates.length} updates — jump to the latest
            </button>
          )}

          <div className="flex flex-col md:min-h-0 md:flex-1">
            {register.isPending && <TableSkeleton />}

            {register.isError && (
              <ErrorState
                title="The register could not be loaded."
                detail="The server did not answer. Your data is safe; this screen is not current."
                onRetry={() => void register.refetch()}
              />
            )}

            {register.isSuccess && visibleRows.length === 0 && (
              <EmptyState
                icon={SearchIcon}
                title={
                  rows.length === 0
                    ? "Nobody is in the register for this day."
                    : filters.status === "checked_in"
                      ? filters.q.trim()
                        ? `Nobody checked in matches “${filters.q.trim()}”.`
                        : "Nobody has checked in yet."
                      : "No one matches these filters."
                }
                detail={
                  rows.length === 0
                    ? "Import the school directory in Admin, then scans will appear here as they happen."
                    : filters.status === "checked_in"
                      ? filters.q.trim()
                        ? "They may not have scanned today."
                        : "Scans appear here as they happen."
                      : "Clear the filters to see everyone."
                }
                action={
                  rows.length > 0 && filters.status === "checked_in" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFilters({ status: "any" })}
                    >
                      Show everyone
                    </Button>
                  ) : undefined
                }
              />
            )}

            {register.isSuccess &&
              visibleRows.length > 0 &&
              (isNarrow ? (
                <RegisterCards
                  rows={visibleRows}
                  recentlyChanged={recentlyChanged}
                  onSelect={setSelectedPersonId}
                />
              ) : (
                <RegisterTable
                  rows={visibleRows}
                  recentlyChanged={recentlyChanged}
                  showTutor={showTutor}
                  compact={isCompact}
                  selectedPersonId={selectedPersonId}
                  onSelect={setSelectedPersonId}
                  scrollToPersonId={scrollToPersonId}
                  onScrolledTo={() => setScrollToPersonId(null)}
                />
              ))}
          </div>
        </div>
      </div>

      <PersonSheet
        personId={selectedPersonId}
        date={filters.date}
        onClose={() => setSelectedPersonId(null)}
        onChanged={() => {
          void register.refetch();
          void summary.refetch();
        }}
      />
    </div>
  );
}

function ConnectionIndicator({
  state,
  lastContactAt,
}: {
  state: ConnectionState;
  lastContactAt: Date | null;
}) {
  const presentation = {
    idle: { dot: "bg-status-idle", label: "Not live", pulse: false },
    live: { dot: "bg-primary", label: "Live", pulse: true },
    connecting: {
      dot: "bg-muted-foreground",
      label: "Connecting",
      pulse: false,
    },
    reconnecting: {
      dot: "bg-status-late",
      label: "Reconnecting",
      pulse: false,
    },
  }[state];

  return (
    <span
      className="inline-flex h-7 items-center gap-2 rounded-full border bg-card px-2.5 text-xs font-medium text-muted-foreground shadow-xs dark:bg-input/20"
      title={
        lastContactAt
          ? `Last update ${lastContactAt.toLocaleTimeString("en-GB")}`
          : undefined
      }
    >
      <span
        className={cn(
          "inline-block size-2 rounded-full",
          presentation.dot,
          presentation.pulse && "animate-live-dot",
        )}
        aria-hidden
      />
      {presentation.label}
    </span>
  );
}

function toRow(event: ScanEventPayload): Partial<RegisterRow> {
  return {
    firstIn: event.firstIn,
    lastOut: event.lastOut,
    lastMovementAt: event.lastMovementAt,
    status: event.status,
    isLate: event.isLate,
    hasManualEdit: event.hasManualEdit,
    scanCount: event.scanCount,
  };
}

function blankFilters(today: string): RegisterFilters {
  return {
    date: today,
    branch: null,
    group: null,
    category: null,
    tutor: null,
    status: DEFAULT_STATUS,
    sort: DEFAULT_SORT,
    q: "",
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.isContentEditable
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

function useIsNarrow(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
