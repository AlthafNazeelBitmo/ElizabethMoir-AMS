import type { Branch, GroupCount } from "@/lib/api.js";
import { cn } from "@/lib/utils.js";

/**
 * The groups, with how many of each are in. The bar under each name is the
 * on-site share, so the one form that is half empty stands out from across
 * the room before its number is read.
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
          onSite={group.onSite}
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

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pt-3 pb-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  );
}

function GroupItem({
  label,
  onSite,
  total,
  active,
  onClick,
  heading,
}: {
  label: string;
  onSite: number;
  total: number;
  active: boolean;
  onClick: () => void;
  heading?: boolean;
}) {
  const share = total > 0 ? (onSite / total) * 100 : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
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
            {onSite}
          </span>
          <span className="opacity-60">/{total}</span>
        </span>
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-500",
            share >= 90
              ? "bg-status-onsite"
              : share >= 60
                ? "bg-status-onsite/70"
                : "bg-status-late",
          )}
          style={{ width: `${share}%` }}
        />
      </span>
    </button>
  );
}
