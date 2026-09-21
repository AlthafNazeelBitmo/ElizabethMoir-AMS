import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Checkbox, Field, Skeleton } from "@/components/ui/misc.js";
import { NativeSelect } from "@/components/ui/input.js";
import { api, type Branch } from "@/lib/api.js";
import { cn } from "@/lib/utils.js";
import { Note, Panel, Problem, Section, Table, Td, Th, Tr } from "./shared.js";

interface Group {
  id: number;
  name: string;
  branch: Branch;
  displayOrder: number;
  lateThreshold: string | null;
  expectsAttendance: boolean;
  isActive: boolean;
  peopleCount: number;
}

/**
 * The groups: forms, years, staff categories — whatever the school calls
 * the units its people are organised into.
 *
 * Each one carries three things the register depends on: which branch it
 * belongs to (which decides who may see its members), whether its members
 * are expected at all (contractors are not reported absent), and its own
 * late threshold if it differs from the school's. The branch is fixed once
 * people are in the group — the server refuses to move them across that
 * line as a side effect of an edit.
 */
export function AdminGroups() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  // Deactivating a group with people takes them all off the register; that
  // is asked, not assumed.
  const [deactivating, setDeactivating] = useState<Group | null>(null);

  const groups = useQuery({
    queryKey: ["admin-groups"],
    queryFn: () => api.get<{ groups: Group[] }>("/api/admin/groups"),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-groups"] });
    // The register's rail and the report's group filter read their own copy.
    void queryClient.invalidateQueries({ queryKey: ["summary"] });
    void queryClient.invalidateQueries({ queryKey: ["summary-groups"] });
  };

  const update = useMutation({
    mutationFn: (args: { id: number; body: Record<string, unknown> }) =>
      api.patch(`/api/admin/groups/${args.id}`, args.body),
    onSuccess: () => {
      invalidate();
      toast.success("Group updated");
    },
  });

  const rows = groups.data?.groups ?? [];
  const students = rows.filter((g) => g.branch === "student");
  const staff = rows.filter((g) => g.branch === "staff");

  const change = (id: number, body: Record<string, unknown>) => {
    const group = rows.find((g) => g.id === id);
    if (body["isActive"] === false && group && group.peopleCount > 0) {
      setDeactivating(group);
      return;
    }
    update.mutate({ id, body });
  };

  return (
    <Section
      title="Groups"
      description="Forms, years and staff categories. Whether a group is students or staff decides who may see its members; whether it expects attendance decides whether its members can be absent."
      actions={
        !adding && (
          <Button onClick={() => setAdding(true)}>
            <PlusIcon /> Add group
          </Button>
        )
      }
    >
      <Problem error={update.error} />

      {adding && (
        <NewGroupForm
          nextOrder={{
            student: Math.max(0, ...students.map((g) => g.displayOrder)) + 1,
            staff: Math.max(0, ...staff.map((g) => g.displayOrder)) + 1,
          }}
          onDone={() => {
            setAdding(false);
            invalidate();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {groups.isPending && <Skeleton className="h-48 w-full" />}

      {groups.isSuccess && rows.length === 0 && (
        <Note>
          No groups yet. Add one, or import the directory — groups named in the
          file are created as it loads.
        </Note>
      )}

      {groups.isSuccess && rows.length > 0 && (
        <>
          <Dialog
            open={deactivating !== null}
            onOpenChange={(open) => {
              if (!open) setDeactivating(null);
            }}
          >
            <DialogContent aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle>Deactivate {deactivating?.name}?</DialogTitle>
                <DialogDescription>
                  It has {deactivating?.peopleCount}{" "}
                  {deactivating?.peopleCount === 1 ? "person" : "people"} in
                  it. They will come off the live register, the rail and the
                  reports with it, and nobody in it can be marked absent,
                  until the group is active again or they are moved to
                  another group. They stay in the directory meanwhile.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDeactivating(null)}>
                  Keep it active
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (deactivating)
                      update.mutate({ id: deactivating.id, body: { isActive: false } });
                    setDeactivating(null);
                  }}
                >
                  Deactivate
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <GroupTable
            title="Students"
            groups={students}
            onChange={change}
          />
          <GroupTable
            title="Staff"
            groups={staff}
            onChange={change}
          />
        </>
      )}

      <Note>
        A group that does not expect attendance never appears in an absence list
        — use it for contractors and visitors who hold a card. Deactivating a
        group hides it from the rail and the filters but changes nothing about
        the people in it; move them first if they are still here.
      </Note>
    </Section>
  );
}

function GroupTable({
  title,
  groups,
  onChange,
}: {
  title: string;
  groups: Group[];
  onChange: (id: number, body: Record<string, unknown>) => void;
}) {
  return (
    <Panel
      title={title}
      description={`${groups.length} ${groups.length === 1 ? "group" : "groups"}`}
    >
      {groups.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">None.</p>
      ) : (
        <Table
          head={
            <>
              <Th>Name</Th>
              <Th className="text-right">People</Th>
              <Th>Order</Th>
              <Th>Late after</Th>
              <Th>Expects attendance</Th>
              <Th>Active</Th>
            </>
          }
        >
          {groups.map((group) => (
            <Tr
              key={group.id}
              className={cn(!group.isActive && "text-muted-foreground")}
            >
              <Td>
                <Input
                  className="w-48"
                  defaultValue={group.name}
                  aria-label={`Name of ${group.name}`}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== group.name)
                      onChange(group.id, { name });
                    else e.target.value = group.name;
                  }}
                />
              </Td>
              <Td className="tabular text-right text-muted-foreground">
                {group.peopleCount}
              </Td>
              <Td>
                <Input
                  type="number"
                  min={0}
                  className="tabular w-16"
                  defaultValue={group.displayOrder}
                  aria-label={`Display order of ${group.name}`}
                  onBlur={(e) => {
                    const order = Number(e.target.value);
                    if (
                      Number.isInteger(order) &&
                      order >= 0 &&
                      order !== group.displayOrder
                    )
                      onChange(group.id, { displayOrder: order });
                  }}
                />
              </Td>
              <Td>
                <Input
                  type="time"
                  className="tabular w-32"
                  defaultValue={group.lateThreshold?.slice(0, 5) ?? ""}
                  aria-label={`Late threshold for ${group.name}`}
                  title="Blank uses the school's late threshold"
                  onBlur={(e) => {
                    const value = e.target.value || null;
                    if (value !== (group.lateThreshold?.slice(0, 5) ?? null))
                      onChange(group.id, { lateThreshold: value });
                  }}
                />
              </Td>
              <Td>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={group.expectsAttendance}
                    onCheckedChange={(checked) =>
                      onChange(group.id, {
                        expectsAttendance: checked === true,
                      })
                    }
                  />
                  {group.expectsAttendance ? "Yes" : "No"}
                </label>
              </Td>
              <Td>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={group.isActive}
                    onCheckedChange={(checked) =>
                      onChange(group.id, { isActive: checked === true })
                    }
                  />
                  {group.isActive ? "Active" : "Inactive"}
                </label>
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

function NewGroupForm({
  nextOrder,
  onDone,
  onCancel,
}: {
  nextOrder: Record<Branch, number>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [branch, setBranch] = useState<Branch>("student");
  const [expectsAttendance, setExpectsAttendance] = useState(true);

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/admin/groups", {
        name: name.trim(),
        branch,
        displayOrder: nextOrder[branch],
        expectsAttendance,
      }),
    onSuccess: () => {
      toast.success(`${name.trim()} added`);
      onDone();
    },
  });

  return (
    <Panel title="New group" className="max-w-lg">
      <form
        className="space-y-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Problem error={create.error} />

        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            autoFocus
            placeholder="Form 3"
          />
        </Field>

        <Field
          label="Branch"
          hint="Fixed once the group has people in it: it decides who may see them."
        >
          <NativeSelect
            value={branch}
            onChange={(e) => setBranch(e.target.value as Branch)}
          >
            <option value="student">Students</option>
            <option value="staff">Staff</option>
          </NativeSelect>
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={expectsAttendance}
            onCheckedChange={(checked) =>
              setExpectsAttendance(checked === true)
            }
          />
          Members are expected on school days
        </label>

        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={create.isPending || name.trim().length === 0}
          >
            {create.isPending ? "Adding…" : "Add group"}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}
