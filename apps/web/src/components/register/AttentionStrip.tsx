import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, IdCardIcon, TriangleAlertIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type CurrentUser } from "@/lib/api.js";
import { cn } from "@/lib/utils.js";

/**
 * What needs a person, if anything.
 *
 * The register shows what is; this shows what to do next, and only when
 * there is something: cards that scanned but match nobody, and deliveries
 * that could not be read. Both are one click from the screen that fixes
 * them. Nothing here is shown to a student-only account, which cannot act
 * on either.
 */
export function AttentionStrip({ user }: { user: CurrentUser }) {
  const enabled = user.role === "full";

  const unknown = useQuery({
    queryKey: ["attention-unknown"],
    queryFn: () =>
      api.get<{ total: number }>("/api/admin/unknown-enrollments?limit=1"),
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const failures = useQuery({
    queryKey: ["attention-failures"],
    queryFn: () => api.get<{ total: number }>("/api/admin/dead-letter?limit=1"),
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const items: Array<{
    key: string;
    to: string;
    tone: "warn" | "bad";
    icon: typeof IdCardIcon;
    text: string;
    action: string;
  }> = [];

  const unknownCount = unknown.data?.total ?? 0;
  if (unknownCount > 0) {
    items.push({
      key: "unknown",
      to: "/admin/unknown",
      tone: "warn",
      icon: IdCardIcon,
      text: `${unknownCount} ${unknownCount === 1 ? "card has" : "cards have"} scanned that match nobody`,
      action: "Give them a name",
    });
  }
  const failureCount = failures.data?.total ?? 0;
  if (failureCount > 0) {
    items.push({
      key: "failures",
      to: "/admin/failures",
      tone: "bad",
      icon: TriangleAlertIcon,
      text: `${failureCount} ${failureCount === 1 ? "delivery" : "deliveries"} from the readers could not be read`,
      action: "Look and replay",
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" role="status">
      {items.map((item) => (
        <Link
          key={item.key}
          to={item.to}
          className={cn(
            "group inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border py-1 pr-2.5 pl-1.5 text-sm transition-colors sm:rounded-full",
            item.tone === "warn" &&
              "border-status-late/30 bg-status-late-bg text-status-late hover:border-status-late/60",
            item.tone === "bad" &&
              "border-status-absent/30 bg-status-absent-bg text-status-absent hover:border-status-absent/60",
          )}
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-card/70">
            <item.icon className="size-3" />
          </span>
          <span>{item.text}</span>
          <span className="inline-flex items-center gap-1 font-medium">
            {item.action}
            <ArrowRightIcon className="size-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      ))}
    </div>
  );
}
