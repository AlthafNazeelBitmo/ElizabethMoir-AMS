import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Field, inputClass } from "../primitives.js";
import { api, type Branch } from "../../lib/api.js";
import { Problem, Section, Table, formatDateTime } from "./shared.js";

interface UnknownEnrollment {
  enrollNo: string;
  firstSeenAt: string;
  lastSeenAt: string;
  scanCount: number;
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
 */
export function AdminUnknownIds() {
  const queryClient = useQueryClient();
  const [attaching, setAttaching] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

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
      setDone(
        `${variables.fullName} now has ID ${variables.enrollNo}. ${data.daysRecomputed} day(s) of their history were recalculated.`,
      );
      setAttaching(null);
      void queryClient.invalidateQueries({ queryKey: ["unknown-enrollments"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
    },
  });

  return (
    <Section
      title="Unknown IDs"
      description="Cards and fingerprints that scanned but match nobody in the directory. Their scans are stored, not discarded — give the number a name and the history comes with it."
    >
      <Problem error={attach.error} />
      {done && <p className="my-2 text-sm text-brand-700">{done}</p>}

      {unknown.isPending && (
        <p className="text-sm text-neutral-500">Loading…</p>
      )}

      {unknown.isSuccess && unknown.data.unknownEnrollments.length === 0 && (
        <p className="text-sm text-neutral-500">
          Every scan is matched to a person.
        </p>
      )}

      {unknown.isSuccess && unknown.data.unknownEnrollments.length > 0 && (
        <Table
          head={
            <>
              <th className="py-2">Enrolment number</th>
              <th className="py-2">Scans</th>
              <th className="py-2">First seen</th>
              <th className="py-2">Last seen</th>
              <th className="py-2" />
            </>
          }
        >
          {unknown.data.unknownEnrollments.map((row) => (
            <tr
              key={row.enrollNo}
              className="border-b border-neutral-100 align-top"
            >
              <td className="tabular py-2 font-medium">{row.enrollNo}</td>
              <td className="tabular py-2">{row.scanCount}</td>
              <td className="py-2 text-neutral-600">
                {formatDateTime(row.firstSeenAt)}
              </td>
              <td className="py-2 text-neutral-600">
                {formatDateTime(row.lastSeenAt)}
              </td>
              <td className="py-2">
                {attaching === row.enrollNo ? (
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
                      <input
                        name="fullName"
                        required
                        className={inputClass}
                        autoFocus
                      />
                    </Field>
                    <Field label="Group">
                      <select name="groupId" required className={inputClass}>
                        {(groups.data?.groups ?? [])
                          .filter((g) => g.isActive)
                          .map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={attach.isPending}
                    >
                      {attach.isPending ? "Saving…" : "Create and attach"}
                    </Button>
                    <Button variant="ghost" onClick={() => setAttaching(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <div className="text-right">
                    <Button onClick={() => setAttaching(row.enrollNo)}>
                      Give this a name
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}
