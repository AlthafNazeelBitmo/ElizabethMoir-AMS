import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, TableSkeleton } from "@/components/states.js";
import { Button } from "@/components/ui/button.js";
import { api } from "@/lib/api.js";
import {
  formatDateTime,
  Panel,
  Problem,
  Section,
  Table,
  Td,
  Th,
  Tr,
} from "./shared.js";

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
      if (data.resolved) {
        toast.success("Replayed", {
          description: "The delivery has been processed.",
        });
      } else {
        toast.error("Still failing", {
          description: data.processError ?? "Unknown reason.",
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["admin-dead-letter"] });
    },
  });

  return (
    <Section
      title="Failed events"
      description="Deliveries from the readers that could not be interpreted. The original is always kept, so nothing is lost — fix the cause, then replay."
    >
      <Problem error={replay.error} />

      <Panel>
        {failures.isPending && <TableSkeleton rows={4} />}

        {failures.isSuccess && failures.data.failures.length === 0 && (
          <EmptyState
            icon={CheckCircle2Icon}
            title="Every delivery has been processed."
            detail="Nothing needs attention."
          />
        )}

        {failures.isSuccess && failures.data.failures.length > 0 && (
          <Table
            head={
              <>
                <Th>Received</Th>
                <Th className="text-right">Events</Th>
                <Th>Problem</Th>
                <Th />
              </>
            }
          >
            {failures.data.failures.map((failure) => (
              <Tr key={failure.id} className="align-top">
                <Td className="tabular text-muted-foreground">
                  {formatDateTime(failure.receivedAt)}
                </Td>
                <Td className="tabular text-right">
                  {failure.batchSize ?? "—"}
                </Td>
                <Td className="whitespace-normal">
                  <span className="text-status-absent">
                    {failure.processError ?? failure.parseError ?? "—"}
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    className="ml-2 h-auto p-0 text-xs"
                    onClick={() =>
                      setExpanded(expanded === failure.id ? null : failure.id)
                    }
                  >
                    {expanded === failure.id ? "Hide body" : "Show body"}
                  </Button>
                  {expanded === failure.id && (
                    <pre className="mt-2 max-h-72 max-w-xl overflow-auto rounded-md border bg-muted/50 p-2 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap">
                      {failure.bodyPreview || "(empty)"}
                    </pre>
                  )}
                </Td>
                <Td className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => replay.mutate(failure.id)}
                    disabled={replay.isPending}
                  >
                    <RotateCcwIcon /> Replay
                  </Button>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>
    </Section>
  );
}
