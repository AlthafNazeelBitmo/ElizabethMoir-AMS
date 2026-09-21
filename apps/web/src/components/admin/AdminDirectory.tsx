import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileSpreadsheetIcon,
  GraduationCapIcon,
  MoreHorizontalIcon,
  PencilLineIcon,
  SearchIcon,
  Trash2Icon,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { PersonDialog, type PersonRecord } from "./PersonForm.js";
import { TutorsDialog, type Tutor } from "./TutorsDialog.js";
import { Input, NativeSelect } from "@/components/ui/input.js";
import { Avatar, Checkbox, Field } from "@/components/ui/misc.js";
import { api, ApiError, type Branch } from "@/lib/api.js";
import { cn } from "@/lib/utils.js";
import { Panel, Problem, Section, Table, Td, Th, Tr } from "./shared.js";

interface Person extends PersonRecord {
  groupName: string | null;
  branch: Branch | null;
  tutorInitials: string | null;
}

interface Group {
  id: number;
  name: string;
  branch: Branch;
  isActive: boolean;
}

interface ImportPreview {
  counts: {
    create: number;
    update: number;
    deactivate: number;
    unchanged: number;
    newTutors: number;
    ungrouped: number;
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
  // "Show deactivated" is a view of its own — the people who have left —
  // not the active list with the leavers mixed in.
  const [showInactive, setShowInactive] = useState(false);
  const [branch, setBranch] = useState<"" | Branch>("");
  const [groupId, setGroupId] = useState("");
  const [tutorId, setTutorId] = useState("");
  const [tutorsOpen, setTutorsOpen] = useState(false);
  const [deleting, setDeleting] = useState<Person | null>(null);
  // A page of fifty, and back to the first whenever the view changes.
  const [page, setPage] = useState(1);
  const view = { search, showInactive, branch, groupId, tutorId };
  const [lastView, setLastView] = useState(view);
  if (JSON.stringify(view) !== JSON.stringify(lastView)) {
    setLastView(view);
    setPage(1);
  }
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    preview: ImportPreview;
    planHash: string;
  } | null>(null);
  // What to do about the people the file is silent about: nothing until
  // the person importing says whether the file is the whole school.
  const [deactivations, setDeactivations] = useState<"ask" | "confirm" | "skip">("ask");
  const fileInput = useRef<HTMLInputElement>(null);

  const people = useQuery({
    queryKey: [
      "admin-people",
      search,
      showInactive,
      branch,
      groupId,
      tutorId,
      page,
    ],
    queryFn: () =>
      api.get<{ people: Person[]; total: number; limit: number }>(
        `/api/admin/people?${new URLSearchParams({
          ...(search ? { q: search } : {}),
          active: showInactive ? "false" : "true",
          ...(branch ? { branch } : {}),
          ...(groupId ? { groupId } : {}),
          ...(tutorId ? { tutorId } : {}),
          page: String(page),
          limit: String(PAGE_SIZE),
        }).toString()}`,
      ),
    placeholderData: (previous) => previous,
  });
  const pageCount = people.data
    ? Math.max(1, Math.ceil(people.data.total / PAGE_SIZE))
    : 1;

  const groups = useQuery({
    queryKey: ["admin-groups"],
    queryFn: () => api.get<{ groups: Group[] }>("/api/admin/groups"),
  });
  const tutors = useQuery({
    queryKey: ["admin-tutors"],
    queryFn: () => api.get<{ tutors: Tutor[] }>("/api/admin/tutors"),
  });
  const filtered = Boolean(search || branch || groupId || tutorId);

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

  const remove = useMutation({
    mutationFn: (person: Person) =>
      api.delete<{ deleted: { dayRecords: number; scans: number } }>(
        `/api/admin/people/${person.id}`,
      ),
    onSuccess: (data, person) => {
      toast.success(`${person.fullName} deleted`, {
        description: `${data.deleted.dayRecords} day(s) of attendance and ${data.deleted.scans} scan(s) removed with them.`,
      });
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-tutors"] });
      void queryClient.invalidateQueries({ queryKey: ["unknown-enrollments"] });
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
        ...(deactivations === "confirm"
          ? { "x-confirm-deactivations": "true" }
          : deactivations === "skip"
            ? { "x-confirm-deactivations": "skip" }
            : {}),
      }),
    onSuccess: (data) => {
      const { result, matched } = data as {
        result: { created: number; updated: number; deactivated: number };
        matched?: { people: number; scans: number; days: number; remaining: number };
      };
      toast.success("Directory imported", {
        description:
          `${result.created} created, ${result.updated} updated, ${result.deactivated} deactivated.` +
          (matched && matched.people > 0
            ? ` ${matched.scans} earlier scan(s) attached to ${matched.people} of them.`
            : "") +
          (matched && matched.remaining > 0
            ? ` ${matched.remaining} more are matched over the next few minutes, or at once under Unknown IDs.`
            : ""),
      });
      setPreview(null);
      setFile(null);
      setDeactivations("ask");
      if (fileInput.current) fileInput.current.value = "";
      void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-tutors"] });
      void queryClient.invalidateQueries({ queryKey: ["unknown-enrollments"] });
      void queryClient.invalidateQueries({ queryKey: ["register"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
  });

  return (
    <Section
      title="People"
      description="The school directory. Import it from a spreadsheet with the columns enroll_no, full_name, branch, group, and optionally tutor_initials, admission_no, category, display_order — or add one person at a time. A blank group, category or place leaves what the person already has (a new person with a blank group is unclassified)."
      actions={
        <>
          <Button variant="outline" onClick={() => setTutorsOpen(true)}>
            <GraduationCapIcon /> Tutors
          </Button>
          <Button onClick={() => setDialog({ open: true, person: null })}>
            <UserPlusIcon /> Add person
          </Button>
        </>
      }
    >
      <PersonDialog
        person={dialog.person}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onSaved={() => undefined}
      />
      <TutorsDialog open={tutorsOpen} onOpenChange={setTutorsOpen} />

      {/* Deleting is the one action here that cannot be undone, so it is
          asked twice: once in the menu, once here with what it takes. */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.fullName}?</DialogTitle>
            <DialogDescription>
              This removes them from the directory along with every day of
              attendance computed for them and every scan filed under ID{" "}
              {deleting?.enrollNo}. The readers' original deliveries are kept,
              and if the card is ever used again the number will appear under
              Unknown IDs. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <Problem error={remove.error} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Keep them
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting)}
            >
              <Trash2Icon />
              {remove.isPending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                {preview.preview.counts.ungrouped > 0 && (
                  <Badge className="border-transparent bg-status-late-bg text-status-late">
                    {preview.preview.counts.ungrouped} with no group — filter
                    by “No group” afterwards to place them
                  </Badge>
                )}
              </div>

              {preview.preview.deactivates.length > 0 && (
                <div className="rounded-md border p-3">
                  <p className="text-sm font-medium">
                    {preview.preview.deactivates.length}{" "}
                    {preview.preview.deactivates.length === 1
                      ? "person is"
                      : "people are"}{" "}
                    in the directory but not in this file.
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Is this file the whole school, or a part of it — one
                    branch, one list? Nothing is imported until you say.
                  </p>
                  <div className="mt-2 flex flex-col gap-1.5 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="deactivations"
                        className="accent-primary"
                        checked={deactivations === "skip"}
                        onChange={() => setDeactivations("skip")}
                      />
                      A part of the school — keep everyone else as they are
                    </label>
                    <label className="flex items-center gap-2 text-status-absent">
                      <input
                        type="radio"
                        name="deactivations"
                        className="accent-[var(--status-absent)]"
                        checked={deactivations === "confirm"}
                        onChange={() => setDeactivations("confirm")}
                      />
                      The whole school — deactivate these{" "}
                      {preview.preview.deactivates.length} people
                    </label>
                  </div>
                  <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">
                      Who they are
                    </summary>
                    <ul className="mt-1 max-h-40 overflow-auto">
                      {preview.preview.deactivates.map((d) => (
                        <li key={d.enrollNo}>
                          {d.fullName}{" "}
                          <span className="tabular opacity-70">
                            ({d.enrollNo})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  disabled={
                    doConfirm.isPending ||
                    (preview.preview.deactivates.length > 0 &&
                      deactivations === "ask")
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
        <div className="flex flex-wrap items-end gap-2 border-b px-3 py-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-56 pl-8"
              placeholder="Search name or ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search people"
            />
          </div>
          <Field label="Branch" className="gap-1">
            <NativeSelect
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value as "" | Branch);
                setGroupId("");
              }}
              className="h-8"
            >
              <option value="">Everyone</option>
              <option value="student">Students</option>
              <option value="staff">Staff</option>
            </NativeSelect>
          </Field>
          <Field label="Group" className="gap-1">
            <NativeSelect
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="h-8"
            >
              <option value="">All groups</option>
              <option value="none">No group</option>
              {(groups.data?.groups ?? [])
                .filter((g) => !branch || g.branch === branch)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                    {!g.isActive ? " (inactive)" : ""}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Tutor" className="gap-1">
            <NativeSelect
              value={tutorId}
              onChange={(e) => setTutorId(e.target.value)}
              className="h-8"
            >
              <option value="">All tutors</option>
              {(tutors.data?.tutors ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.initials}
                  {t.fullName ? ` · ${t.fullName}` : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <label className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={showInactive}
              onCheckedChange={(checked) => setShowInactive(checked === true)}
            />
            Show deactivated
          </label>
          {people.isSuccess && (
            <span className="tabular ml-auto self-center text-xs text-muted-foreground">
              {people.data.total.toLocaleString("en-GB")}
              {showInactive ? " deactivated" : " people"}
            </span>
          )}
        </div>

        {people.isPending && <TableSkeleton rows={8} />}

        {people.isSuccess && people.data.people.length === 0 && (
          <EmptyState
            icon={UsersIcon}
            title={
              showInactive
                ? filtered
                  ? "Nobody deactivated matches these filters."
                  : "Nobody has been deactivated."
                : filtered
                  ? "Nobody matches these filters."
                  : "The directory is empty."
            }
            detail={
              showInactive || filtered ? undefined : "Import a spreadsheet above."
            }
          />
        )}

        {people.isSuccess && people.data.people.length > 0 && (
          <Table
            head={
              <>
                <Th>Name</Th>
                <Th>ID</Th>
                <Th>Group</Th>
                <Th>Category</Th>
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
                  {person.category ?? "—"}
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
                      {!person.isActive && (
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleting(person)}
                        >
                          <Trash2Icon /> Delete…
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Td>
              </Tr>
            ))}
          </Table>
        )}

        {people.isSuccess && pageCount > 1 && (
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span className="tabular">
              {(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, people.data.total)} of{" "}
              {people.data.total.toLocaleString("en-GB")}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeftIcon /> Previous
              </Button>
              <span className="tabular px-1">
                Page {page} of {pageCount}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Next <ChevronRightIcon />
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </Section>
  );
}

const PAGE_SIZE = 50;
