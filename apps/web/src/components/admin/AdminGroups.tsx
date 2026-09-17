import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Field, inputClass } from "../primitives.js";
import { api, type Branch } from "../../lib/api.js";
import { Problem, Section, Table } from "./shared.js";

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
    onSuccess: invalidate,
  });

  const rows = groups.data?.groups ?? [];
  const students = rows.filter((g) => g.branch === "student");
  const staff = rows.filter((g) => g.branch === "staff");

  return (
    <Section
      title="Groups"
      description="Forms, years and staff categories. Whether a group is students or staff decides who may see its members; whether it expects attendance decides whether its members can be absent."
      actions={
        !adding && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add group
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

      {groups.isPending && <p className="text-sm text-neutral-500">Loading…</p>}

      {groups.isSuccess && rows.length === 0 && (
        <p className="text-sm text-neutral-500">
          No groups yet. Add one, or import the directory — groups named in the
          file are created as it loads.
        </p>
      )}

      {groups.isSuccess && rows.length > 0 && (
        <div className="space-y-6">
          <GroupTable
            title="Students"
            groups={students}
            onChange={(id, body) => update.mutate({ id, body })}
          />
          <GroupTable
            title="Staff"
            groups={staff}
            onChange={(id, body) => update.mutate({ id, body })}
          />
        </div>
      )}

      <p className="mt-4 max-w-2xl text-xs text-neutral-500">
        A group that does not expect attendance never appears in an absence list
        — use it for contractors and visitors who hold a card. Deactivating a
        group hides it from the rail and the filters but changes nothing about
        the people in it; move them first if they are still here.
      </p>
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
    <div>
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h2>
      {groups.length === 0 ? (
        <p className="text-sm text-neutral-500">None.</p>
      ) : (
        <Table
          head={
            <>
              <th className="py-2">Name</th>
              <th className="py-2">People</th>
              <th className="py-2">Order</th>
              <th className="py-2">Late after</th>
              <th className="py-2">Expects attendance</th>
              <th className="py-2">Active</th>
            </>
          }
        >
          {groups.map((group) => (
            <tr
              key={group.id}
              className={`border-b border-neutral-100 ${group.isActive ? "" : "text-neutral-400"}`}
            >
              <td className="py-2">
                <input
                  className="w-44 rounded border border-neutral-300 px-1.5 py-1 text-sm"
                  defaultValue={group.name}
                  aria-label={`Name of ${group.name}`}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== group.name)
                      onChange(group.id, { name });
                    else e.target.value = group.name;
                  }}
                />
              </td>
              <td className="tabular py-2 text-neutral-600">
                {group.peopleCount}
              </td>
              <td className="py-2">
                <input
                  type="number"
                  min={0}
                  className="w-16 rounded border border-neutral-300 px-1.5 py-1 text-sm"
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
              </td>
              <td className="py-2">
                <input
                  type="time"
                  className="rounded border border-neutral-300 px-1.5 py-1 text-sm"
                  defaultValue={group.lateThreshold?.slice(0, 5) ?? ""}
                  aria-label={`Late threshold for ${group.name}`}
                  title="Blank uses the school's late threshold"
                  onBlur={(e) => {
                    const value = e.target.value || null;
                    if (value !== (group.lateThreshold?.slice(0, 5) ?? null))
                      onChange(group.id, { lateThreshold: value });
                  }}
                />
              </td>
              <td className="py-2">
                <label className="flex items-center gap-1.5 text-sm text-neutral-600">
                  <input
                    type="checkbox"
                    checked={group.expectsAttendance}
                    onChange={(e) =>
                      onChange(group.id, {
                        expectsAttendance: e.target.checked,
                      })
                    }
                  />
                  {group.expectsAttendance ? "Yes" : "No"}
                </label>
              </td>
              <td className="py-2">
                <label className="flex items-center gap-1.5 text-sm text-neutral-600">
                  <input
                    type="checkbox"
                    checked={group.isActive}
                    onChange={(e) =>
                      onChange(group.id, { isActive: e.target.checked })
                    }
                  />
                  {group.isActive ? "Active" : "Inactive"}
                </label>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
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
    onSuccess: onDone,
  });

  return (
    <form
      className="mb-4 max-w-md space-y-3 rounded border border-neutral-200 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <Problem error={create.error} />

      <Field label="Name">
        <input
          className={inputClass}
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
        <select
          className={inputClass}
          value={branch}
          onChange={(e) => setBranch(e.target.value as Branch)}
        >
          <option value="student">Students</option>
          <option value="staff">Staff</option>
        </select>
      </Field>

      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={expectsAttendance}
          onChange={(e) => setExpectsAttendance(e.target.checked)}
        />
        Members are expected on school days
      </label>

      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={create.isPending || name.trim().length === 0}
        >
          {create.isPending ? "Adding…" : "Add group"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
