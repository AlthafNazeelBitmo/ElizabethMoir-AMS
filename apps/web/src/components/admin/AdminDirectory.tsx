import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, inputClass } from "../primitives.js";
import { api, ApiError, type Branch } from "../../lib/api.js";
import { Problem, Section, Table } from "./shared.js";

interface Person {
  id: string;
  enrollNo: string;
  fullName: string;
  groupName: string | null;
  branch: Branch | null;
  tutorInitials: string | null;
  isActive: boolean;
}

interface ImportPreview {
  counts: {
    create: number;
    update: number;
    deactivate: number;
    unchanged: number;
    newTutors: number;
  };
  creates: Array<{ enrollNo: string; fullName: string; groupName: string }>;
  updates: Array<{
    enrollNo: string;
    fullName: string;
    changes: Array<{
      field: string;
      before: string | null;
      after: string | null;
    }>;
  }>;
  deactivates: Array<{ enrollNo: string; fullName: string }>;
  newTutorInitials: string[];
  truncated: { creates: number; updates: number };
}

/**
 * The directory, and the spreadsheet import.
 *
 * The import is two steps on purpose: nothing is written until somebody has
 * seen exactly what would change and said yes. Deactivations need a second
 * confirmation of their own, because a truncated export should not quietly
 * remove half the school.
 */
export function AdminDirectory() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    preview: ImportPreview;
    planHash: string;
  } | null>(null);
  const [confirmDeactivations, setConfirmDeactivations] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const people = useQuery({
    queryKey: ["admin-people", search],
    queryFn: () =>
      api.get<{ people: Person[]; total: number }>(
        `/api/admin/people?${new URLSearchParams(search ? { q: search } : {}).toString()}`,
      ),
  });

  /** Uploads the file as a raw body, which the endpoint accepts. */
  const upload = async (
    path: string,
    extraHeaders: Record<string, string> = {},
  ) => {
    if (!file) throw new ApiError(400, "no_file", "Choose a CSV file first.");
    const csrf = /(?:^|;\s*)ams_csrf=([^;]+)/.exec(document.cookie)?.[1];
    const res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "text/csv",
        ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {}),
        ...extraHeaders,
      },
      body: await file.text(),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const shaped = (body ?? {}) as {
        error?: string;
        message?: string;
        problems?: unknown;
      };
      throw new ApiError(
        res.status,
        shaped.error ?? "error",
        shaped.message ?? "The import failed.",
        Array.isArray(shaped.problems)
          ? shaped.problems.map((p) =>
              typeof p === "string"
                ? p
                : `line ${(p as { lineNumber?: number }).lineNumber ?? "?"}: ${(p as { message?: string }).message ?? ""}`,
            )
          : [],
      );
    }
    return body;
  };

  const doPreview = useMutation({
    mutationFn: () => upload("/api/admin/people/import"),
    onSuccess: (data) => {
      setPreview(data as { preview: ImportPreview; planHash: string });
      setDone(null);
    },
  });

  const doConfirm = useMutation({
    mutationFn: () =>
      upload("/api/admin/people/import/confirm", {
        "x-plan-hash": preview!.planHash,
        ...(confirmDeactivations ? { "x-confirm-deactivations": "true" } : {}),
      }),
    onSuccess: (data) => {
      const result = (
        data as {
          result: { created: number; updated: number; deactivated: number };
        }
      ).result;
      setDone(
        `Imported: ${result.created} created, ${result.updated} updated, ${result.deactivated} deactivated.`,
      );
      setPreview(null);
      setFile(null);
      setConfirmDeactivations(false);
      void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
    },
  });

  return (
    <Section
      title="People"
      description="The school directory. Import it from a spreadsheet with the columns enroll_no, full_name, branch, group, tutor_initials, admission_no."
    >
      <div className="mb-4 rounded border border-neutral-200 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".csv,text/csv"
            className="text-sm"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setDone(null);
            }}
          />
          <Button
            variant="primary"
            disabled={!file || doPreview.isPending}
            onClick={() => doPreview.mutate()}
          >
            {doPreview.isPending ? "Checking…" : "Check file"}
          </Button>
        </div>

        <Problem error={doPreview.error ?? doConfirm.error} />
        {done && <p className="mt-2 text-sm text-brand-700">{done}</p>}

        {preview && (
          <div className="mt-3">
            <p className="text-sm text-neutral-700">
              <strong>{preview.preview.counts.create}</strong> to create,{" "}
              <strong>{preview.preview.counts.update}</strong> to update,{" "}
              <strong>{preview.preview.counts.deactivate}</strong> to
              deactivate, {preview.preview.counts.unchanged} unchanged.
              {preview.preview.counts.newTutors > 0 &&
                ` ${preview.preview.counts.newTutors} new tutor(s): ${preview.preview.newTutorInitials.join(", ")}.`}
            </p>

            {preview.preview.deactivates.length > 0 && (
              <div className="mt-2 rounded border border-rose-200 bg-status-absentBg p-2">
                <p className="text-sm font-medium text-status-absent">
                  These {preview.preview.deactivates.length} people are not in
                  the file and would be deactivated:
                </p>
                <ul className="mt-1 max-h-40 overflow-auto text-sm text-status-absent">
                  {preview.preview.deactivates.map((d) => (
                    <li key={d.enrollNo}>
                      {d.fullName} ({d.enrollNo})
                    </li>
                  ))}
                </ul>
                <label className="mt-2 flex items-center gap-1.5 text-sm text-status-absent">
                  <input
                    type="checkbox"
                    checked={confirmDeactivations}
                    onChange={(e) => setConfirmDeactivations(e.target.checked)}
                  />
                  Yes, deactivate these people
                </label>
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <Button
                variant="primary"
                disabled={
                  doConfirm.isPending ||
                  (preview.preview.deactivates.length > 0 &&
                    !confirmDeactivations)
                }
                onClick={() => doConfirm.mutate()}
              >
                {doConfirm.isPending ? "Importing…" : "Import"}
              </Button>
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <input
        className={`${inputClass} mb-3 w-64`}
        placeholder="Search name or ID"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search people"
      />

      {people.isPending && <p className="text-sm text-neutral-500">Loading…</p>}

      {people.isSuccess && people.data.people.length === 0 && (
        <p className="text-sm text-neutral-500">
          {search
            ? "Nobody matches that search."
            : "The directory is empty. Import a spreadsheet above."}
        </p>
      )}

      {people.isSuccess && people.data.people.length > 0 && (
        <>
          <p className="mb-1 text-xs text-neutral-500">
            {people.data.total} people; showing {people.data.people.length}.
          </p>
          <Table
            head={
              <>
                <th className="py-2">Name</th>
                <th className="py-2">ID</th>
                <th className="py-2">Group</th>
                <th className="py-2">Tutor</th>
              </>
            }
          >
            {people.data.people.map((person) => (
              <tr key={person.id} className="border-b border-neutral-100">
                <td className="py-1.5">{person.fullName}</td>
                <td className="tabular py-1.5 text-neutral-500">
                  {person.enrollNo}
                </td>
                <td className="py-1.5 text-neutral-600">
                  {person.groupName ?? "—"}
                </td>
                <td className="py-1.5 text-neutral-500">
                  {person.tutorInitials ?? "—"}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Section>
  );
}
