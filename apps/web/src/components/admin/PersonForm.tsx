import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Input, NativeSelect } from "@/components/ui/input.js";
import { Field } from "@/components/ui/misc.js";
import { api, type Branch } from "@/lib/api.js";
import { Problem } from "./shared.js";

/**
 * One person, added or edited by hand.
 *
 * The spreadsheet import is for the whole school; this is for the one new
 * pupil in October. The enrolment number is the number the reader knows
 * them by — it is the only thing that ties a scan to a name, which is why
 * it cannot be changed once set: the scans already filed under it would
 * lose their owner.
 */

export interface PersonRecord {
  id: string;
  enrollNo: string;
  fullName: string;
  admissionNo: string | null;
  groupId: number | null;
  tutorId: number | null;
  displayOrder: number | null;
  isActive: boolean;
}

interface Group {
  id: number;
  name: string;
  branch: Branch;
  isActive: boolean;
}

interface Tutor {
  id: number;
  initials: string;
  fullName: string | null;
}

export function PersonDialog({
  person,
  open,
  onOpenChange,
  onSaved,
}: {
  /** Absent for a new person. */
  person?: PersonRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        {open && (
          <PersonForm
            person={person ?? null}
            onDone={() => {
              onSaved();
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PersonForm({
  person,
  onDone,
  onCancel,
}: {
  person: PersonRecord | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const editing = person !== null;

  const [enrollNo, setEnrollNo] = useState(person?.enrollNo ?? "");
  const [fullName, setFullName] = useState(person?.fullName ?? "");
  const [groupId, setGroupId] = useState<string>(
    person?.groupId ? String(person.groupId) : "",
  );
  const [tutorId, setTutorId] = useState<string>(
    person?.tutorId ? String(person.tutorId) : "",
  );
  const [admissionNo, setAdmissionNo] = useState(person?.admissionNo ?? "");
  const [displayOrder, setDisplayOrder] = useState(
    person?.displayOrder === null || person?.displayOrder === undefined
      ? ""
      : String(person.displayOrder),
  );

  const groups = useQuery({
    queryKey: ["admin-groups"],
    queryFn: () => api.get<{ groups: Group[] }>("/api/admin/groups"),
  });
  const tutors = useQuery({
    queryKey: ["admin-tutors"],
    queryFn: () => api.get<{ tutors: Tutor[] }>("/api/admin/tutors"),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        fullName: fullName.trim(),
        groupId: groupId ? Number(groupId) : null,
        tutorId: tutorId ? Number(tutorId) : null,
        admissionNo: admissionNo.trim() || null,
        displayOrder: displayOrder.trim() === "" ? null : Number(displayOrder),
      };
      return editing
        ? api.patch(`/api/admin/people/${person.id}`, body)
        : api.post("/api/admin/people", { enrollNo: enrollNo.trim(), ...body });
    },
    onSuccess: () => {
      toast.success(editing ? "Saved" : `${fullName.trim()} added`, {
        description: editing
          ? undefined
          : "Any scans already filed under that number now belong to them.",
      });
      void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
      void queryClient.invalidateQueries({ queryKey: ["unknown-enrollments"] });
      void queryClient.invalidateQueries({ queryKey: ["register"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      onDone();
    },
  });

  const activeGroups = (groups.data?.groups ?? []).filter((g) => g.isActive);
  const students = activeGroups.filter((g) => g.branch === "student");
  const staff = activeGroups.filter((g) => g.branch === "staff");

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? "Edit person" : "Add a person"}</DialogTitle>
        <DialogDescription>
          {editing
            ? "The enrolment number stays: scans are filed under it."
            : "For one new pupil or member of staff. For the whole school, import the spreadsheet instead."}
        </DialogDescription>
      </DialogHeader>

      <Problem error={save.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Enrolment number"
          hint="The number the reader knows them by, exactly as enrolled in ADMS."
        >
          <Input
            value={enrollNo}
            onChange={(e) => setEnrollNo(e.target.value)}
            required
            maxLength={64}
            disabled={editing}
            autoFocus={!editing}
            className="tabular"
          />
        </Field>

        <Field label="Full name">
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            maxLength={200}
            autoFocus={editing}
          />
        </Field>

        <Field
          label="Group"
          hint="Decides whether they are a student or staff, and who may see them."
        >
          <NativeSelect
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="w-full"
          >
            <option value="">No group</option>
            {students.length > 0 && (
              <optgroup label="Students">
                {students.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
            )}
            {staff.length > 0 && (
              <optgroup label="Staff">
                {staff.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
            )}
          </NativeSelect>
        </Field>

        <Field label="Tutor" hint="Optional.">
          <NativeSelect
            value={tutorId}
            onChange={(e) => setTutorId(e.target.value)}
            className="w-full"
          >
            <option value="">None</option>
            {(tutors.data?.tutors ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.initials}
                {t.fullName ? ` — ${t.fullName}` : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Admission number" hint="Optional.">
          <Input
            value={admissionNo}
            onChange={(e) => setAdmissionNo(e.target.value)}
            maxLength={64}
            className="tabular"
          />
        </Field>

        <Field
          label="Place in list"
          hint="Optional. Their position in the school's list: 1 comes first. Those without one follow, by name."
        >
          <Input
            type="number"
            min={0}
            max={999999}
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            className="tabular"
          />
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={
            save.isPending ||
            fullName.trim().length === 0 ||
            enrollNo.trim().length === 0
          }
        >
          {save.isPending ? "Saving…" : editing ? "Save" : "Add person"}
        </Button>
      </DialogFooter>
    </form>
  );
}
