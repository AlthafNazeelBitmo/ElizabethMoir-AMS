import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3Icon,
  FileSpreadsheetIcon,
  MoreHorizontalIcon,
  PencilLineIcon,
  SearchIcon,
  UploadIcon,
  UserCheckIcon,
  UserPlusIcon,
  UserXIcon,
  UsersIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { EmptyState, TableSkeleton } from "@/components/states.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { PersonDialog, type PersonRecord } from "./PersonForm.js";
import { Input } from "@/components/ui/input.js";
import { Avatar, Checkbox } from "@/components/ui/misc.js";
import { api, ApiError, type Branch } from "@/lib/api.js";
import { cn } from "@/lib/utils.js";
import { Panel, Problem, Section, Table, Td, Th, Tr } from "./shared.js";

interface Person extends PersonRecord {
  groupName: string | null;
  branch: Branch | null;
  tutorInitials: string | null;
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
  const [dialog, setDialog] = useState<{ open: boolean; person: Person | null }>({
    open: false,
    person: null,
  });
  const [showInactive, setShowInactive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    preview: ImportPreview;
    planHash: string;
  } | null>(null);
  const [confirmDeactivations, setConfirmDeactivations] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const people = useQuery({
    queryKey: ["admin-people", search, showInactive],
    queryFn: () =>
      api.get<{ people: Person[]; total: number }>(
        `/api/admin/people?${new URLSearchParams({
          ...(search ? { q: search } : {}),
          ...(showInactive ? { includeInactive: "true" } : {}),
        }).toString()}`,
      ),
  });

  const setActive = useMutation({
    mutationFn: (args: { person: Person; isActive: boolean }) =>
      api.patch(`/api/admin/people/${args.person.id}`, { isActive: args.isActive }),
    onSuccess: (_data, args) => {
      toast.success(
        args.isActive
          ? `${args.person.fullName} reactivated`
          : `${args.person.fullName} deactivated`,
        {
          description: args.isActive
            ? "Back on the register from today."
            : "Off the register; their history is kept.",
        },
      );
      void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
      void queryClient.invalidateQueries({ queryKey: ["register"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
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
    onSuccess: (data) =>
      setPreview(data as { preview: ImportPreview; planHash: string }),
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
      toast.success("Directory imported", {
        description: `${result.created} created, ${result.updated} updated, ${result.deactivated} deactivated.`,
      });
      setPreview(null);
      setFile(null);
      setConfirmDeactivations(false);
      if (fileInput.current) fileInput.current.value = "";
      void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
    },
  });

  return (
    <Section
      title="People"
      description="The school directory. Import it from a spreadsheet with the columns enroll_no, full_name, branch, group, tutor_initials, admission_no — or add one person at a time."
      actions={
        <Button onClick={() => setDialog({ open: true, person: null })}>
          <UserPlusIcon /> Add person
        </Button>
      }
    >
      <PersonDialog
        person={dialog.person}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onSaved={() => undefined}
      />

      <Panel
        title="Import from a spreadsheet"
        description="Nothing is written until you have seen what would change."
      >
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={cn(
                "flex h-8 cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 text-sm transition-colors hover:bg-muted/50",
                file
                  ? "border-primary/50 text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <FileSpreadsheetIcon className="size-4" />
              {file ? file.name : "Choose a CSV file"}
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                }}
              />
            </label>
            <Button
              disabled={!file || doPreview.isPending}
              onClick={() => doPreview.mutate()}
            >
              <UploadIcon /> {doPreview.isPending ? "Checking…" : "Check file"}
            </Button>
          </div>

          <Problem error={doPreview.error ?? doConfirm.error} />

          {preview && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge className="border-transparent bg-status-onsite-bg text-status-onsite">
                  {preview.preview.counts.create} to create
                </Badge>
                <Badge variant="secondary">
                  {preview.preview.counts.update} to update
                </Badge>
                <Badge
                  className={cn(
                    "border-transparent",
                    preview.preview.counts.deactivate > 0
                      ? "bg-status-absent-bg text-status-absent"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {preview.preview.counts.deactivate} to deactivate
                </Badge>
                <Badge variant="muted">
                  {preview.preview.counts.unchanged} unchanged
                </Badge>
                {preview.preview.counts.newTutors > 0 && (
                  <Badge variant="outline">
                    {preview.preview.counts.newTutors} new tutor(s):{" "}
                    {preview.preview.newTutorInitials.join(", ")}
                  </Badge>
                )}
              </div>

              {preview.preview.deactivates.length > 0 && (
                <div className="rounded-md border border-status-absent/30 bg-status-absent-bg p-3">
                  <p className="text-sm font-medium text-status-absent">
                    These {preview.preview.deactivates.length} people are not in
                    the file and would be deactivated:
                  </p>
                  <ul className="mt-1 max-h-40 overflow-auto text-sm text-status-absent">
                    {preview.preview.deactivates.map((d) => (
                      <li key={d.enrollNo}>
                        {d.fullName}{" "}
                        <span className="tabular opacity-70">
                          ({d.enrollNo})
                        </span>
                      </li>
                    ))}
                  </ul>
                  <label className="mt-2 flex items-center gap-2 text-sm text-status-absent">
                    <Checkbox
                      checked={confirmDeactivations}
                      onCheckedChange={(checked) =>
                        setConfirmDeactivations(checked === true)
                      }
                    />
                    Yes, deactivate these people
                  </label>
                </div>
              )}

              <div className="flex gap-2">
                <Button
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
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-64 pl-8"
              placeholder="Search name or ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search people"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={showInactive}
              onCheckedChange={(checked) => setShowInactive(checked === true)}
            />
            Show deactivated
          </label>
          {people.isSuccess && (
            <span className="tabular ml-auto text-xs text-muted-foreground">
              {people.data.total.toLocaleString("en-GB")} people
              {people.data.people.length !== people.data.total &&
                `; showing ${people.data.people.length}`}
            </span>
          )}
        </div>

        {people.isPending && <TableSkeleton rows={8} />}

        {people.isSuccess && people.data.people.length === 0 && (
          <EmptyState
            icon={UsersIcon}
            title={
              search ? "Nobody matches that search." : "The directory is empty."
            }
            detail={search ? undefined : "Import a spreadsheet above."}
          />
        )}

        {people.isSuccess && people.data.people.length > 0 && (
          <Table
            head={
              <>
                <Th>Name</Th>
                <Th>ID</Th>
                <Th>Group</Th>
                <Th>Tutor</Th>
                <Th />
              </>
            }
          >
            {people.data.people.map((person) => (
              <Tr
                key={person.id}
                className={cn(!person.isActive && "text-muted-foreground")}
              >
                <Td>
                  <span className="flex items-center gap-2.5">
                    <Avatar name={person.fullName} size="sm" />
                    <span className="font-medium">{person.fullName}</span>
                    {!person.isActive && (
                      <Badge variant="muted">Inactive</Badge>
                    )}
                  </span>
                </Td>
                <Td className="tabular text-muted-foreground">
                  {person.enrollNo}
                </Td>
                <Td className="text-muted-foreground">
                  {person.groupName ?? "—"}
                </Td>
                <Td className="text-muted-foreground">
                  {person.tutorInitials ?? "—"}
                </Td>
                <Td className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${person.fullName}`}
                      >
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => setDialog({ open: true, person })}
                      >
                        <PencilLineIcon /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to={`/reports/person/${person.id}`}>
                          <BarChart3Icon /> Report
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant={person.isActive ? "destructive" : "default"}
                        onSelect={() =>
                          setActive.mutate({ person, isActive: !person.isActive })
                        }
                      >
                        {person.isActive ? (
                          <>
                            <UserXIcon /> Deactivate
                          </>
                        ) : (
                          <>
                            <UserCheckIcon /> Reactivate
                          </>
                        )}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>
    </Section>
  );
}
