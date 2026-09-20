import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  RefreshCwIcon,
  UserPlusIcon,
  UserRoundCheckIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, TableSkeleton } from "@/components/states.js";
import { Button } from "@/components/ui/button.js";
import { Input, NativeSelect } from "@/components/ui/input.js";
import { Field } from "@/components/ui/misc.js";
import { api, type Branch } from "@/lib/api.js";
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

interface UnknownEnrollment {
  enrollNo: string;
  firstSeenAt: string;
  lastSeenAt: string;
  scanCount: number;
  /** Set when the number is a deactivated person's: their card still works. */
  formerPersonId: string | null;
  formerName: string | null;
}

interface Group {
  id: number;
  name: string;
  branch: Branch;
  isActive: boolean;
}

/**
 * Enrolment numbers nobody has claimed.
 *
 * This is how a newly enrolled student becomes visible without a separate
 * registration module: they are enrolled on the reader, they scan, their
 * number turns up here, and somebody gives it a name. The office uses it
 * weekly, so it is two clicks rather than a form.
 *
 * The scans recorded before anyone knew who they were are not lost — they
 * are attached to the person and their days recomputed straight away.
 *
 * A number can also land here because its owner was deactivated and the
 * card kept opening the reader. The row says whose it was and offers to
 * bring them back, which claims the scans; it does not offer to create a
 * second person with the same number.
 */
export function AdminUnknownIds() {
  const queryClient = useQueryClient();
  const [attaching, setAttaching] = useState<string | null>(null);

  const unknown = useQuery({
    queryKey: ["unknown-enrollments"],
    queryFn: () =>
      api.get<{ unknownEnrollments: UnknownEnrollment[]; total: number }>(
        "/api/admin/unknown-enrollments",
      ),
  });

  const groups = useQuery({
    queryKey: ["admin-groups"],
    queryFn: () => api.get<{ groups: Group[] }>("/api/admin/groups"),
  });

  const attach = useMutation({
    mutationFn: (args: {
      enrollNo: string;
      fullName: string;
      groupId: number;
    }) =>
      api.post<{ personId: string; daysRecomputed: number }>(
        `/api/admin/unknown-enrollments/${encodeURIComponent(args.enrollNo)}/attach`,
        { create: { fullName: args.fullName, groupId: args.groupId } },
      ),
    onSuccess: (data, variables) => {
      toast.success(`${variables.fullName} now has ID ${variables.enrollNo}`, {
        description: `${data.daysRecomputed} day(s) of their history were recalculated.`,
      });
      setAttaching(null);
      void queryClient.invalidateQueries({ queryKey: ["unknown-enrollments"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
    },
  });

  const match = useMutation({
    mutationFn: () =>
      api.post<{ matched: { people: number; scans: number; days: number } }>(
        "/api/admin/unknown-enrollments/match",
        {},
      ),
    onSuccess: ({ matched }) => {
      if (matched.people === 0) {
        toast.message("Nothing to match", {
          description: "No number on this list belongs to anyone in the directory.",
        });
      } else {
        toast.success(
          `${matched.people} ${matched.people === 1 ? "number" : "numbers"} matched`,
          {
            description: `${matched.scans} scan(s) attached and ${matched.days} day(s) recalculated.`,
          },
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["unknown-enrollments"] });
      void queryClient.invalidateQueries({ queryKey: ["register"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
  });

  const reactivate = useMutation({
    mutationFn: (args: { personId: string; fullName: string }) =>
      api.patch<{ daysRecomputed: number }>(
        `/api/admin/people/${encodeURIComponent(args.personId)}`,
        { isActive: true },
      ),
    onSuccess: (data, variables) => {
      toast.success(`${variables.fullName} is back on the register`, {
        description: `${data.daysRecomputed} day(s) of scans were claimed for them.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["unknown-enrollments"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
    },
  });

  return (
    <Section
      title="Unknown IDs"
      description="Cards and fingerprints that scanned but match nobody in the directory. Their scans are stored, not discarded — give the number a name and the history comes with it. After a spreadsheet import, numbers that now have a name are matched on their own; the button does it at once."
      actions={
        <Button
          variant="outline"
          onClick={() => match.mutate()}
          disabled={match.isPending}
        >
          <RefreshCwIcon className={match.isPending ? "animate-spin" : undefined} />
          {match.isPending ? "Matching…" : "Match against the directory"}
        </Button>
      }
    >
      <Problem error={attach.error ?? reactivate.error ?? match.error} />

      <Panel>
        {unknown.isPending && <TableSkeleton rows={4} />}

        {unknown.isSuccess && unknown.data.unknownEnrollments.length === 0 && (
          <EmptyState
            icon={CheckCircle2Icon}
            title="Every scan is matched to a person."
          />
        )}

        {unknown.isSuccess && unknown.data.unknownEnrollments.length > 0 && (
          <Table
            head={
              <>
                <Th>Enrolment number</Th>
                <Th className="text-right">Scans</Th>
                <Th>First seen</Th>
                <Th>Last seen</Th>
                <Th />
              </>
            }
          >
            {unknown.data.unknownEnrollments.map((row) => (
              <Tr key={row.enrollNo} className="align-top">
                <Td className="font-medium">
                  <span className="tabular">{row.enrollNo}</span>
                  {row.formerName && (
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      Was {row.formerName}, deactivated
                    </span>
                  )}
                </Td>
                <Td className="tabular text-right">{row.scanCount}</Td>
                <Td className="tabular text-muted-foreground">
                  {formatDateTime(row.firstSeenAt)}
                </Td>
                <Td className="tabular text-muted-foreground">
                  {formatDateTime(row.lastSeenAt)}
                </Td>
                <Td>
                  {row.formerPersonId && row.formerName ? (
                    <div className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={reactivate.isPending}
                        onClick={() =>
                          reactivate.mutate({
                            personId: row.formerPersonId!,
                            fullName: row.formerName!,
                          })
                        }
                      >
                        <UserRoundCheckIcon /> Reactivate {row.formerName}
                      </Button>
                    </div>
                  ) : attaching === row.enrollNo ? (
                    <form
                      className="flex flex-wrap items-end justify-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        attach.mutate({
                          enrollNo: row.enrollNo,
                          fullName: String(data.get("fullName")),
                          groupId: Number(data.get("groupId")),
                        });
                      }}
                    >
                      <Field label="Full name">
                        <Input
                          name="fullName"
                          required
                          autoFocus
                          className="w-48"
                        />
                      </Field>
                      <Field label="Group">
                        <NativeSelect name="groupId" required>
                          {(groups.data?.groups ?? [])
                            .filter((g) => g.isActive)
                            .map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                        </NativeSelect>
                      </Field>
                      <Button type="submit" disabled={attach.isPending}>
                        {attach.isPending ? "Saving…" : "Create and attach"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setAttaching(null)}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <div className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAttaching(row.enrollNo)}
                      >
                        <UserPlusIcon /> Give this a name
                      </Button>
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>
    </Section>
  );
}
