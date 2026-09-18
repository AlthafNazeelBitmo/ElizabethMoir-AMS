import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveRestoreIcon,
  CheckCircle2Icon,
  EyeOffIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, TableSkeleton } from "@/components/states.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/misc.js";
import { api } from "@/lib/api.js";
import { cn } from "@/lib/utils.js";
import {
  formatDateTime,
  Note,
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
  dismissedAt: string | null;
  dismissedBy: string | null;
  bodyPreview: string;
}

/**
 * Deliveries the system could not interpret.
 *
 * The raw envelope is kept for every one of them, so nothing is lost — a
 * failure here is something to look at, not something to mourn. Replaying
 * is safe to do twice: the processor deduplicates, so a delivery that half
 * succeeded will not double anything up. One that will never succeed — a
 * test post, a probe, plain text — is dismissed: set aside with a name and
 * a time, never deleted, and back with one click.
 */
export function AdminFailures() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const failures = useQuery({
    queryKey: ["admin-dead-letter", showDismissed],
    queryFn: () =>
      api.get<{ failures: Failure[]; total: number }>(
        `/api/admin/dead-letter${showDismissed ? "?includeDismissed=true" : ""}`,
      ),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-dead-letter"] });
    void queryClient.invalidateQueries({ queryKey: ["attention-failures"] });
  };

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
      refresh();
    },
  });

  const dismiss = useMutation({
    mutationFn: (args: { id: number; dismissed: boolean }) =>
      api.patch(`/api/admin/dead-letter/${args.id}`, {
        dismissed: args.dismissed,
      }),
    onSuccess: (_data, args) => {
      toast.success(args.dismissed ? "Set aside" : "Back in the list", {
        description: args.dismissed
          ? "Kept, with your name against it. Show dismissed to find it again."
          : undefined,
      });
      refresh();
    },
  });

  const rows = failures.data?.failures ?? [];

  return (
    <Section
      title="Failed events"
      description="Deliveries from the readers that could not be interpreted. The original is always kept, so nothing is lost — fix the cause, then replay."
    >
      <Problem error={replay.error ?? dismiss.error} />

      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={showDismissed}
              onCheckedChange={(checked) => setShowDismissed(checked === true)}
            />
            Show dismissed
          </label>
          {failures.isSuccess && (
            <span className="tabular ml-auto text-xs text-muted-foreground">
              {failures.data.total}{" "}
              {failures.data.total === 1 ? "delivery" : "deliveries"}
            </span>
          )}
        </div>

        {failures.isPending && <TableSkeleton rows={4} />}

        {failures.isSuccess && rows.length === 0 && (
          <EmptyState
            icon={CheckCircle2Icon}
            title={
              showDismissed
                ? "Nothing has ever failed."
                : "Every delivery has been processed."
            }
            detail={showDismissed ? undefined : "Nothing needs attention."}
          />
        )}

        {failures.isSuccess && rows.length > 0 && (
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
            {rows.map((failure) => {
              const isDismissed = failure.dismissedAt !== null;
              return (
                <Tr
                  key={failure.id}
                  className={cn(
                    "align-top",
                    isDismissed && "text-muted-foreground",
                  )}
                >
                  <Td className="tabular text-muted-foreground">
                    {formatDateTime(failure.receivedAt)}
                    {isDismissed && (
                      <Badge variant="muted" className="mt-1 block w-fit">
                        Dismissed
                        {failure.dismissedBy
                          ? ` by ${failure.dismissedBy}`
                          : ""}
                      </Badge>
                    )}
                  </Td>
                  <Td className="tabular text-right">
                    {failure.batchSize ?? "—"}
                  </Td>
                  <Td className="whitespace-normal">
                    <span className={cn(!isDismissed && "text-status-absent")}>
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
                    <div className="flex justify-end gap-1">
                      {isDismissed ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            dismiss.mutate({ id: failure.id, dismissed: false })
                          }
                          disabled={dismiss.isPending}
                        >
                          <ArchiveRestoreIcon /> Restore
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => replay.mutate(failure.id)}
                            disabled={replay.isPending}
                          >
                            <RotateCcwIcon /> Replay
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Dismiss delivery ${failure.id}`}
                            onClick={() =>
                              dismiss.mutate({
                                id: failure.id,
                                dismissed: true,
                              })
                            }
                            disabled={dismiss.isPending}
                          >
                            <EyeOffIcon /> Dismiss
                          </Button>
                        </>
                      )}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Panel>

      <Note>
        Dismiss is for a delivery that will never succeed — a test post, a
        probe, plain text where a scan was due. It is set aside, not deleted:
        the body and the reason stay, your name goes against it, and Show
        dismissed brings it back into view.
      </Note>
    </Section>
  );
}
