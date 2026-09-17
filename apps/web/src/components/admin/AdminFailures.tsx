import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../primitives.js";
import { api } from "../../lib/api.js";
import { Problem, Section, Table, formatDateTime } from "./shared.js";

interface Failure {
  id: number;
  receivedAt: string;
  contentType: string | null;
  batchSize: number | null;
  parseError: string | null;
  processError: string | null;
  bodyPreview: string;
}

/**
 * Deliveries the system could not interpret.
 *
 * The raw envelope is kept for every one of them, so nothing is lost — a
 * failure here is something to look at, not something to mourn. Replaying
 * is safe to do twice: the processor deduplicates, so a delivery that half
 * succeeded will not double anything up.
 */
export function AdminFailures() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const failures = useQuery({
    queryKey: ["admin-dead-letter"],
    queryFn: () =>
      api.get<{ failures: Failure[]; total: number }>("/api/admin/dead-letter"),
  });

  const replay = useMutation({
    mutationFn: (id: number) =>
      api.post<{ resolved: boolean; processError: string | null }>(
        `/api/admin/dead-letter/${id}/replay`,
      ),
    onSuccess: (data) => {
      setLastResult(
        data.resolved
          ? "Replayed successfully. The delivery has been processed."
          : `Still failing: ${data.processError ?? "unknown reason"}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin-dead-letter"] });
    },
  });

  return (
    <Section
      title="Failed events"
      description="Deliveries from the readers that could not be interpreted. The original is always kept, so nothing is lost — fix the cause, then replay."
    >
      <Problem error={replay.error} />
      {lastResult && (
        <p className="my-2 rounded border border-neutral-200 bg-neutral-50 p-2 text-sm text-neutral-700">
          {lastResult}
        </p>
      )}

      {failures.isPending && (
        <p className="text-sm text-neutral-500">Loading…</p>
      )}

      {failures.isSuccess && failures.data.failures.length === 0 && (
        <p className="text-sm text-neutral-500">
          Every delivery has been processed. Nothing needs attention.
        </p>
      )}

      {failures.isSuccess && failures.data.failures.length > 0 && (
        <Table
          head={
            <>
              <th className="py-2">Received</th>
              <th className="py-2">Events</th>
              <th className="py-2">Problem</th>
              <th className="py-2" />
            </>
          }
        >
          {failures.data.failures.map((failure) => (
            <tr
              key={failure.id}
              className="border-b border-neutral-100 align-top"
            >
              <td className="py-1.5 whitespace-nowrap text-neutral-600">
                {formatDateTime(failure.receivedAt)}
              </td>
              <td className="tabular py-1.5">{failure.batchSize ?? "—"}</td>
              <td className="py-1.5 text-neutral-700">
                {failure.processError ?? failure.parseError ?? "—"}
                <button
                  className="ml-2 text-xs text-brand-700 hover:underline"
                  onClick={() =>
                    setExpanded(expanded === failure.id ? null : failure.id)
                  }
                >
                  {expanded === failure.id ? "Hide body" : "Show body"}
                </button>
                {expanded === failure.id && (
                  <pre className="mt-1 max-w-xl overflow-auto rounded bg-neutral-50 p-2 text-xs text-neutral-700">
                    {failure.bodyPreview || "(empty)"}
                  </pre>
                )}
              </td>
              <td className="py-1.5 text-right">
                <Button
                  onClick={() => replay.mutate(failure.id)}
                  disabled={replay.isPending}
                >
                  Replay
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}
