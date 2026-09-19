import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
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
import { api } from "@/lib/api.js";
import { Problem, Table, Td, Th, Tr } from "./shared.js";

export interface Tutor {
  id: number;
  initials: string;
  fullName: string | null;
  peopleCount: number;
}

/**
 * The tutors: initials, a name, and how many people each one has.
 *
 * The spreadsheet creates tutors as it meets them; this is for the one who
 * joins in October. A tutor with people cannot be removed — the people
 * screen filters by tutor, so moving them is two clicks away — and the
 * initials are what the register and the reports print, so they are kept
 * short and upper-case.
 */
export function TutorsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [initials, setInitials] = useState("");
  const [fullName, setFullName] = useState("");

  const tutors = useQuery({
    queryKey: ["admin-tutors"],
    queryFn: () => api.get<{ tutors: Tutor[] }>("/api/admin/tutors"),
    enabled: open,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-tutors"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
  };

  const add = useMutation({
    mutationFn: () =>
      api.post<{ tutor: Tutor }>("/api/admin/tutors", {
        initials: initials.trim(),
        fullName: fullName.trim() || null,
      }),
    onSuccess: (data) => {
      toast.success(`Tutor ${data.tutor.initials} added`);
      setInitials("");
      setFullName("");
      refresh();
    },
  });

  const rename = useMutation({
    mutationFn: (args: { tutor: Tutor; fullName: string | null }) =>
      api.patch(`/api/admin/tutors/${args.tutor.id}`, {
        fullName: args.fullName,
      }),
    onSuccess: () => refresh(),
  });

  const remove = useMutation({
    mutationFn: (tutor: Tutor) => api.delete(`/api/admin/tutors/${tutor.id}`),
    onSuccess: (_data, tutor) => {
      toast.success(`Tutor ${tutor.initials} removed`);
      refresh();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Tutors</DialogTitle>
          <DialogDescription>
            The initials are what the register and the reports show. A tutor
            with people cannot be removed until they are moved.
          </DialogDescription>
        </DialogHeader>

        <Problem error={add.error ?? rename.error ?? remove.error} />

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium leading-none text-muted-foreground">
              Initials
            </span>
            <Input
              value={initials}
              onChange={(e) => setInitials(e.target.value.toUpperCase())}
              maxLength={8}
              required
              className="w-24 uppercase"
              aria-label="New tutor initials"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium leading-none text-muted-foreground">
              Name (optional)
            </span>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={200}
              aria-label="New tutor name"
            />
          </label>
          <Button
            type="submit"
            disabled={add.isPending || initials.trim().length === 0}
          >
            <PlusIcon /> Add tutor
          </Button>
        </form>

        <div className="max-h-80 overflow-y-auto rounded-lg border">
          {tutors.isSuccess && tutors.data.tutors.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              No tutors yet. Add one above, or import the spreadsheet with a
              tutor_initials column.
            </p>
          )}
          {tutors.isSuccess && tutors.data.tutors.length > 0 && (
            <Table
              head={
                <>
                  <Th>Initials</Th>
                  <Th>Name</Th>
                  <Th className="text-right">People</Th>
                  <Th />
                </>
              }
            >
              {tutors.data.tutors.map((tutor) => (
                <Tr key={tutor.id}>
                  <Td className="font-medium">{tutor.initials}</Td>
                  <Td>
                    <Input
                      defaultValue={tutor.fullName ?? ""}
                      placeholder="—"
                      aria-label={`Name of tutor ${tutor.initials}`}
                      className="h-7 max-w-xs"
                      onBlur={(e) => {
                        const next = e.target.value.trim() || null;
                        if (next !== (tutor.fullName ?? null))
                          rename.mutate({ tutor, fullName: next });
                      }}
                    />
                  </Td>
                  <Td className="tabular text-right text-muted-foreground">
                    {tutor.peopleCount}
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove tutor ${tutor.initials}`}
                      disabled={remove.isPending || tutor.peopleCount > 0}
                      title={
                        tutor.peopleCount > 0
                          ? "Move their people to another tutor first."
                          : undefined
                      }
                      onClick={() => remove.mutate(tutor)}
                    >
                      <Trash2Icon />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Table>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
