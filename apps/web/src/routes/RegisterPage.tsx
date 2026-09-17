import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { PersonPanel } from "../components/PersonPanel.js";
import { RegisterCards, RegisterTable } from "../components/RegisterTable.js";
import { SummaryCounters } from "../components/SummaryCounters.js";
import {
  Button,
  EmptyState,
  ErrorState,
  TableSkeleton,
  inputClass,
} from "../components/primitives.js";
import {
  useRegisterStream,
  type ConnectionState,
  type ScanEventPayload,
} from "../hooks/useRegisterStream.js";
import {
  fetchAllRegisterRows,
  api,
  type CurrentUser,
  type DayStatus,
  type RegisterPage as RegisterPageData,
  type RegisterRow,
  type SummaryResponse,
} from "../lib/api.js";
import {
  filtersFromSearch,
  hasActiveFilters,
  queryFromFilters,
  searchFromFilters,
  type RegisterFilters,
} from "../lib/filters.js";
import { formatDate, schoolToday } from "../lib/format.js";

/**
 * The live register.
 *
 * This is what somebody has open on a monitor all day, so the rules are
 * strict: the page itself never scrolls, a new scan updates its row in
 * place without re-sorting or refetching, and the connection state is
 * always visible. Stale data is never shown as though it were live.
 */
export function RegisterPage() {
  const user = useOutletContext<CurrentUser>();
  const today = schoolToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = filtersFromSearch(searchParams, today);

  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [scrollToPersonId, setScrollToPersonId] = useState<string | null>(null);

  // Rows changed by the stream, held so the table can highlight them and
  // then forget about them.
  const [recentlyChanged, setRecentlyChanged] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [offscreenUpdates, setOffscreenUpdates] = useState<string[]>([]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchDraft, setSearchDraft] = useState(filters.q);

  const setFilters = useCallback(
    (next: Partial<RegisterFilters>) => {
      const merged = { ...filters, ...next };
      setSearchParams(searchFromFilters(merged, today), { replace: true });
    },
    [filters, setSearchParams, today],
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

  // "/" focuses search; Escape closes the panel.
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

      setOffscreenUpdates((current) =>
        current.includes(event.personId)
          ? current
          : [...current, event.personId],
      );
      void summary.refetch();
    },
    [filters.date, summary],
  );

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
    return rows.filter((row) => {
      if (filters.status && row.status !== filters.status) return false;
      if (!needle) return true;
      return (
        row.fullName.toLowerCase().includes(needle) ||
        row.enrollNo.toLowerCase().includes(needle)
      );
    });
  }, [rows, filters.status, filters.q]);

  const showTutor = filters.branch !== "staff";
  const isNarrow = useIsNarrow();

  return (
    <div className="flex h-full min-h-0">
      <GroupRail
        groups={summary.data?.groups ?? []}
        activeGroup={filters.group}
        activeBranch={filters.branch}
        canSeeStaff={user.role === "full"}
        onSelect={(branch, group) => setFilters({ branch, group })}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2">
          <input
            type="date"
            className={inputClass}
            value={filters.date}
            max={today}
            onChange={(e) => setFilters({ date: e.target.value || today })}
            aria-label="Date"
          />

          <input
            ref={searchInputRef}
            type="search"
            className={`${inputClass} w-56`}
            placeholder="Search name or ID    /"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            aria-label="Search by name or ID"
          />

          <select
            className={inputClass}
            value={filters.status ?? ""}
            onChange={(e) =>
              setFilters({
                status: (e.target.value || null) as DayStatus | null,
              })
            }
            aria-label="Status"
          >
            <option value="">Any status</option>
            <option value="on_site">On site</option>
            <option value="departed">Departed</option>
            <option value="absent">Absent</option>
            <option value="not_expected">Not expected</option>
          </select>

          {/* Only shown when something is actually set. */}
          {hasActiveFilters(filters) && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearchDraft("");
                setSearchParams(
                  searchFromFilters({ ...blankFilters(today) }, today),
                  {
                    replace: true,
                  },
                );
              }}
            >
              Clear filters
            </Button>
          )}

          <div className="ml-auto">
            <ConnectionIndicator
              state={stream.state}
              lastContactAt={stream.lastContactAt}
            />
          </div>
        </div>

        {stream.state === "reconnecting" && (
          <div
            role="status"
            className="shrink-0 border-b border-amber-300 bg-status-lateBg px-3 py-1.5 text-sm text-status-late"
          >
            Reconnecting — showing data from{" "}
            {stream.lastContactAt
              ? stream.lastContactAt.toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "when the page loaded"}
            .
          </div>
        )}

        <SummaryCounters
          counts={summary.data?.counts}
          activeStatus={filters.status}
          onSelectStatus={(status) => setFilters({ status })}
        />

        {offscreenUpdates.length > 2 && (
          <button
            onClick={() => {
              setScrollToPersonId(offscreenUpdates.at(-1) ?? null);
              setOffscreenUpdates([]);
            }}
            className="mx-3 mb-2 shrink-0 self-start rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
          >
            {offscreenUpdates.length} updates — jump to the latest
          </button>
        )}

        <div className="min-h-0 flex-1">
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
              title={
                hasActiveFilters(filters)
                  ? "No one matches these filters."
                  : "Nobody is in the register for this day."
              }
              detail={
                hasActiveFilters(filters)
                  ? "Clear the filters to see everyone."
                  : "Import the school directory in Admin, then scans will appear here as they happen."
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
                selectedPersonId={selectedPersonId}
                onSelect={setSelectedPersonId}
                scrollToPersonId={scrollToPersonId}
                onScrolledTo={() => setScrollToPersonId(null)}
              />
            ))}
        </div>
      </div>

      {selectedPersonId && (
        <PersonPanel
          personId={selectedPersonId}
          date={filters.date}
          onClose={() => setSelectedPersonId(null)}
          onChanged={() => {
            void register.refetch();
            void summary.refetch();
          }}
        />
      )}
    </div>
  );
}

function GroupRail({
  groups,
  activeGroup,
  activeBranch,
  canSeeStaff,
  onSelect,
}: {
  groups: SummaryResponse["groups"];
  activeGroup: number | null;
  activeBranch: "student" | "staff" | null;
  canSeeStaff: boolean;
  onSelect: (branch: "student" | "staff" | null, group: number | null) => void;
}) {
  const students = groups.filter((g) => g.branch === "student");
  const staff = groups.filter((g) => g.branch === "staff");

  return (
    <nav
      aria-label="Groups"
      className="hidden w-52 shrink-0 overflow-auto border-r border-neutral-200 bg-white py-2 md:block"
    >
      <RailSection
        title="All students"
        active={activeBranch === "student" && activeGroup === null}
        onClick={() => onSelect("student", null)}
      />
      {students.map((group) => (
        <RailItem
          key={group.groupId}
          label={group.name}
          onSite={group.onSite}
          total={group.total}
          active={activeGroup === group.groupId}
          onClick={() => onSelect("student", group.groupId)}
        />
      ))}

      {/* A student-only account gets no staff navigation whatsoever. */}
      {canSeeStaff && (
        <>
          <RailSection
            title="All staff"
            active={activeBranch === "staff" && activeGroup === null}
            onClick={() => onSelect("staff", null)}
          />
          {staff.map((group) => (
            <RailItem
              key={group.groupId}
              label={group.name}
              onSite={group.onSite}
              total={group.total}
              active={activeGroup === group.groupId}
              onClick={() => onSelect("staff", group.groupId)}
            />
          ))}
        </>
      )}

      <div className="mt-3 border-t border-neutral-100 pt-2">
        <RailSection
          title="Everyone"
          active={activeBranch === null && activeGroup === null}
          onClick={() => onSelect(null, null)}
        />
      </div>
    </nav>
  );
}

function RailSection({
  title,
  active,
  onClick,
}: {
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`block w-full px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide ${
        active ? "text-brand-700" : "text-neutral-500 hover:text-neutral-700"
      }`}
    >
      {title}
    </button>
  );
}

function RailItem({
  label,
  onSite,
  total,
  active,
  onClick,
}: {
  label: string;
  onSite: number;
  total: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
        active
          ? "bg-brand-50 font-medium text-brand-700"
          : "text-neutral-700 hover:bg-neutral-50"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="tabular shrink-0 text-xs text-neutral-500">
        {onSite}/{total}
      </span>
    </button>
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
    idle: { dot: "bg-neutral-300", label: "Not live" },
    live: { dot: "bg-brand-600", label: "Live" },
    connecting: { dot: "bg-neutral-400", label: "Connecting" },
    reconnecting: { dot: "bg-status-late", label: "Reconnecting" },
  }[state];

  return (
    <span
      className="flex items-center gap-1.5 text-xs text-neutral-500"
      title={
        lastContactAt
          ? `Last update ${lastContactAt.toLocaleTimeString("en-GB")}`
          : undefined
      }
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${presentation.dot}`}
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
    tutor: null,
    status: null,
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

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export type { RegisterPageData };
