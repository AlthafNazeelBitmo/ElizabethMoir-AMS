import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api.js";

/**
 * The two numbers that want acting on: cards that scanned but match
 * nobody, and deliveries that could not be read. Shown on the register's
 * attention strip and beside the sidebar's entries for the screens that
 * fix them, from one pair of queries. Their keys sit under the lists'
 * keys, so whatever invalidates a list refreshes its count.
 */
export function useAttentionCounts(enabled: boolean): {
  unknown: number;
  failures: number;
} {
  const unknown = useQuery({
    queryKey: ["unknown-enrollments", "count"],
    queryFn: () =>
      api.get<{ total: number }>("/api/admin/unknown-enrollments?limit=1"),
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const failures = useQuery({
    queryKey: ["admin-dead-letter", "count"],
    queryFn: () => api.get<{ total: number }>("/api/admin/dead-letter?limit=1"),
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  return {
    unknown: unknown.data?.total ?? 0,
    failures: failures.data?.total ?? 0,
  };
}
