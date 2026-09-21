import type { Branch, GroupCount } from "@/lib/api.js";
import type { GroupFilter } from "@/lib/filters.js";
import { cn } from "@/lib/utils.js";

/**
 * The groups, with how many of each have checked in today — the same
 * people the register lists when it opens — out of how many there are.
 * The bar under each name is that share, so the one form that is half
 * empty stands out from across the room before its number is read.
 * Everyone, the students and the staff are three parts ruled apart, each
 * with its heading, and the people in no group get a line of their own so
 * the rail adds up to the roll.
 */
export function GroupsPanel({
  groups,
  ungrouped,
  activeGroup,
  activeBranch,
  canSeeStaff,
  onSelect,
  className,
}: {
  groups: GroupCount[];
  ungrouped: { checkedIn: number; total: number };
  activeGroup: GroupFilter | null;
  activeBranch: Branch | null;
  canSeeStaff: boolean;
  onSelect: (branch: Branch | null, group: GroupFilter | null) => void;
  className?: string;
}) {
  const students = groups.filter((g) => g.branch === "student");
  const staff = groups.filter((g) => g.branch === "staff");
  const sum = (list: Array<{ checkedIn: number; total: number }>) =>
    list.reduce(
      (acc, g) => ({
        checkedIn: acc.checkedIn + g.checkedIn,
        total: acc.total + g.total,
      }),
      { checkedIn: 0, total: 0 },
    );

  return (
    <nav
      aria-label="Groups"
      className={cn(
        // The frame clips; the scrolling happens inside it, so the scrollbar
        // stays within the rounded corners instead of poking out of them.
        "flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs",
        className,
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
      <GroupItem
        label="Everyone"
        {...sum([...groups, ungrouped])}
        active={activeBranch === null && activeGroup === null}
        onClick={() => onSelect(null, null)}
        heading
      />

      <SectionLabel>Students</SectionLabel>
      <GroupItem
        label="All students"
        {...sum(students)}
        active={activeBranch === "student" && activeGroup === null}
        onClick={() => onSelect("student", null)}
        heading
      />
      {students.map((group) => (
        <GroupItem
          key={group.groupId}
          label={group.name}
          checkedIn={group.checkedIn}
          total={group.total}
          active={activeGroup === group.groupId}
          onClick={() => onSelect("student", group.groupId)}
        />
      ))}

      {/* A student-only account gets no staff navigation whatsoever. */}
      {canSeeStaff && (
        <>
          <SectionLabel>Staff</SectionLabel>
          <GroupItem
            label="All staff"
            {...sum(staff)}
            active={activeBranch === "staff" && activeGroup === null}
            onClick={() => onSelect("staff", null)}
            heading
          />
          {staff.map((group) => (
            <GroupItem
              key={group.groupId}
              label={group.name}
              checkedIn={group.checkedIn}
              total={group.total}
              active={activeGroup === group.groupId}
              onClick={() => onSelect("staff", group.groupId)}
            />
          ))}
        </>
      )}

      {/* People the directory has not placed yet. Only an account that can
          see everyone sees them; they belong to no branch. */}
      {canSeeStaff && ungrouped.total > 0 && (
        <>
          <SectionLabel>Unplaced</SectionLabel>
          <GroupItem
            label="No group"
            checkedIn={ungrouped.checkedIn}
            total={ungrouped.total}
            active={activeGroup === "none"}
            onClick={() => onSelect(null, "none")}
          />
        </>
      )}
      </div>
    </nav>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    // A band the full width of the rail, so the three parts read as parts.
    <div className="-mx-2 mt-2 mb-1 border-y bg-muted/50 px-4 py-1.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  );
}

function GroupItem({
  label,
  checkedIn,
  total,
  active,
  onClick,
  heading,
}: {
  label: string;
  checkedIn: number;
  total: number;
  active: boolean;
  onClick: () => void;
  heading?: boolean;
}) {
  const share = total > 0 ? (checkedIn / total) * 100 : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-md px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
        active ? "bg-accent text-accent-foreground" : "hover:bg-muted/70",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "truncate text-sm",
            heading ? "font-semibold" : "font-medium",
            !active && !heading && "text-foreground/85",
          )}
        >
          {label}
        </span>
        <span className="tabular shrink-0 text-xs text-muted-foreground">
          <span className={cn(active && "text-primary font-medium")}>
            {checkedIn}
          </span>
          <span className="opacity-60">/{total}</span>
        </span>
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-500",
            share >= 90
              ? "bg-primary"
              : share >= 60
                ? "bg-primary/70"
                : "bg-primary/40",
          )}
          style={{ width: `${share}%` }}
        />
      </span>
    </button>
  );
}
