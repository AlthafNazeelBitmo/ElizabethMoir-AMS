import type { Branch, GroupCount } from "@/lib/api.js";
import { cn } from "@/lib/utils.js";

/**
 * The groups, with how many of each are in.
 *
 * Each row carries a small ring filled to the group's on-site share, so
 * the one form that is half empty is seen from across the room before its
 * number is read. The number itself is "in / of": the in count in the
 * foreground, the size of the group set back. A branch heading is itself a
 * row — "Students", with the branch's own ring and total — because it is
 * also a filter.
 */
export function GroupsPanel({
  groups,
  activeGroup,
  activeBranch,
  canSeeStaff,
  onSelect,
  className,
}: {
  groups: GroupCount[];
  activeGroup: number | null;
  activeBranch: Branch | null;
  canSeeStaff: boolean;
  onSelect: (branch: Branch | null, group: number | null) => void;
  className?: string;
}) {
  const students = groups.filter((g) => g.branch === "student");
  const staff = groups.filter((g) => g.branch === "staff");
  const sum = (list: GroupCount[]) =>
    list.reduce(
      (acc, g) => ({
        onSite: acc.onSite + g.onSite,
        total: acc.total + g.total,
      }),
      { onSite: 0, total: 0 },
    );

  return (
    <nav
      aria-label="Groups"
      className={cn(
        "flex min-h-0 flex-col overflow-y-auto rounded-xl border bg-card p-1.5 shadow-xs",
        className,
      )}
    >
      <GroupItem
        label="Everyone"
        {...sum(groups)}
        active={activeBranch === null && activeGroup === null}
        onClick={() => onSelect(null, null)}
        heading
      />

      <GroupItem
        label="Students"
        {...sum(students)}
        active={activeBranch === "student" && activeGroup === null}
        onClick={() => onSelect("student", null)}
        section
      />
      {students.map((group) => (
        <GroupItem
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
          <GroupItem
            label="Staff"
            {...sum(staff)}
            active={activeBranch === "staff" && activeGroup === null}
            onClick={() => onSelect("staff", null)}
            section
          />
          {staff.map((group) => (
            <GroupItem
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
    </nav>
  );
}

function GroupItem({
  label,
  onSite,
  total,
  active,
  onClick,
  heading,
  section,
}: {
  label: string;
  onSite: number;
  total: number;
  active: boolean;
  onClick: () => void;
  /** "Everyone": the top row, set in a heavier hand. */
  heading?: boolean;
  /** A branch: a small-capitals row that heads the groups under it. */
  section?: boolean;
}) {
  const share = total > 0 ? (onSite / total) * 100 : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      aria-label={`${label}: ${onSite} of ${total} in`}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-md py-1.5 pr-2 pl-2.5 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
        section && "mt-2.5",
        active ? "bg-accent text-accent-foreground" : "hover:bg-muted/70",
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary"
        />
      )}
      <Ring share={share} empty={total === 0} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          heading && "text-sm font-semibold",
          section &&
            "text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase",
          !heading && !section && "text-sm text-foreground/90",
          active && section && "text-accent-foreground",
        )}
      >
        {label}
      </span>
      <span
        className="tabular shrink-0 text-xs text-muted-foreground"
        aria-hidden
      >
        <span
          className={cn(
            "font-semibold",
            onSite > 0 ? "text-foreground" : "text-muted-foreground",
            active && onSite > 0 && "text-primary",
          )}
        >
          {onSite}
        </span>
        <span className="mx-0.5 opacity-50">/</span>
        {total}
      </span>
    </button>
  );
}

/** The on-site share as a ring: full is everyone in, empty is nobody. */
function Ring({ share, empty }: { share: number; empty: boolean }) {
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(100, share));
  return (
    <svg
      viewBox="0 0 22 22"
      className="size-[22px] shrink-0 -rotate-90"
      aria-hidden
    >
      <circle
        cx="11"
        cy="11"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        className={cn("stroke-muted", empty && "[stroke-dasharray:2_2]")}
      />
      {filled > 0 && (
        <circle
          cx="11"
          cy="11"
          r={radius}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - filled / 100)}
          className={cn(
            "transition-[stroke-dashoffset] duration-500",
            filled >= 90
              ? "stroke-status-onsite"
              : filled >= 60
                ? "stroke-status-onsite/70"
                : "stroke-status-late",
          )}
        />
      )}
    </svg>
  );
}
