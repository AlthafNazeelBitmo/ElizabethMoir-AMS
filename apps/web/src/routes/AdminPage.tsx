import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState } from "../components/primitives.js";
import { api } from "../lib/api.js";
import { formatDate } from "../lib/format.js";

interface UnknownEnrollment {
  enrollNo: string;
  firstSeenAt: string;
  lastSeenAt: string;
  scanCount: number;
}

/**
 * Admin, partially built.
 *
 * The unknown-enrolment list is here because the office uses it weekly and
 * it is the mechanism by which a newly enrolled student becomes visible
 * without a separate registration module. The rest of admin arrives in
 * Phase 6; the endpoints behind it already exist and are tested.
 */
export function AdminPage() {
  const unknown = useQuery({
    queryKey: ["unknown-enrollments"],
    queryFn: () =>
      api.get<{ unknownEnrollments: UnknownEnrollment[]; total: number }>(
        "/api/admin/unknown-enrollments",
      ),
  });

  return (
    <div className="h-full overflow-auto p-4">
      <h1 className="mb-3 text-sm font-semibold text-brand-700">Unknown IDs</h1>

      {unknown.isPending && (
        <p className="text-sm text-neutral-500">Loading…</p>
      )}

      {unknown.isError && (
        <ErrorState
          title="The unknown ID list could not be loaded."
          onRetry={() => void unknown.refetch()}
        />
      )}

      {unknown.isSuccess && unknown.data.unknownEnrollments.length === 0 && (
        <EmptyState title="Every scan is matched to a person." />
      )}

      {unknown.isSuccess && unknown.data.unknownEnrollments.length > 0 && (
        <table className="w-full max-w-3xl border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs font-semibold text-neutral-600">
              <th className="py-2">Enrolment number</th>
              <th className="py-2">Scans</th>
              <th className="py-2">First seen</th>
              <th className="py-2">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {unknown.data.unknownEnrollments.map((row) => (
              <tr key={row.enrollNo} className="border-b border-neutral-100">
                <td className="tabular py-2 font-medium">{row.enrollNo}</td>
                <td className="tabular py-2">{row.scanCount}</td>
                <td className="py-2 text-neutral-600">
                  {formatDate(new Date(row.firstSeenAt))}
                </td>
                <td className="py-2 text-neutral-600">
                  {formatDate(new Date(row.lastSeenAt))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-6 max-w-xl text-sm text-neutral-500">
        Attaching a number to a person, the directory import, devices, groups
        and users arrive in Phase 6. Until then the command line does it:{" "}
        <code className="rounded bg-neutral-100 px-1 py-0.5">
          pnpm --filter @ams/api import-directory people.csv
        </code>
      </p>
    </div>
  );
}
