import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRoundIcon,
  MoreHorizontalIcon,
  UserPlusIcon,
  UserXIcon,
  UserCheckIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TableSkeleton } from "@/components/states.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Input, NativeSelect } from "@/components/ui/input.js";
import { Avatar, Field } from "@/components/ui/misc.js";
import { api, type UserRole } from "@/lib/api.js";
import { cn } from "@/lib/utils.js";
import {
  formatDateTime,
  Note,
  OneTimePassword,
  Panel,
  Problem,
  Section,
  Table,
  Td,
  Th,
  Tr,
} from "./shared.js";

interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  failedAttempts: number;
}

export function AdminUsers() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{
    email: string;
    password: string;
  } | null>(null);

  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () =>
      api.get<{ users: AdminUser[]; total: number }>("/api/admin/users"),
  });

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["admin-users"] });

  const create = useMutation({
    mutationFn: (body: { email: string; fullName: string; role: UserRole }) =>
      api.post<{ user: AdminUser; temporaryPassword: string }>(
        "/api/admin/users",
        body,
      ),
    onSuccess: (data) => {
      setIssued({ email: data.user.email, password: data.temporaryPassword });
      setCreating(false);
      refresh();
    },
  });

  const update = useMutation({
    mutationFn: (args: {
      id: string;
      body: Record<string, unknown>;
      email: string;
    }) =>
      api.patch<{ user: AdminUser; temporaryPassword?: string }>(
        `/api/admin/users/${args.id}`,
        args.body,
      ),
    onSuccess: (data, variables) => {
      if (data.temporaryPassword) {
        setIssued({ email: variables.email, password: data.temporaryPassword });
      } else {
        toast.success("Account updated");
      }
      refresh();
    },
  });

  return (
    <Section
      title="Users"
      description="Who can sign in, and what they can see. A student-only account never sees staff, anywhere."
      actions={
        !creating && (
          <Button onClick={() => setCreating(true)}>
            <UserPlusIcon /> Add user
          </Button>
        )
      }
    >
      {issued && (
        <OneTimePassword
          password={issued.password}
          onDone={() => setIssued(null)}
        />
      )}

      {creating && (
        <Panel title="New account" className="max-w-2xl">
          <form
            className="flex flex-wrap items-end gap-3 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              create.mutate({
                email: String(data.get("email")),
                fullName: String(data.get("fullName")),
                role: String(data.get("role")) as UserRole,
              });
            }}
          >
            <Field label="Email">
              <Input
                name="email"
                type="email"
                required
                className="w-56"
                autoFocus
              />
            </Field>
            <Field label="Full name">
              <Input name="fullName" required className="w-48" />
            </Field>
            <Field label="Role">
              <NativeSelect name="role" defaultValue="student_only">
                <option value="student_only">Students only</option>
                <option value="full">Students and staff (admin)</option>
              </NativeSelect>
            </Field>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create"}
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </form>
        </Panel>
      )}

      <Problem error={create.error ?? update.error} />

      <Panel>
        {users.isPending && <TableSkeleton rows={4} />}

        {users.isSuccess && (
          <Table
            head={
              <>
                <Th>Account</Th>
                <Th>Role</Th>
                <Th>Last signed in</Th>
                <Th>Status</Th>
                <Th />
              </>
            }
          >
            {users.data.users.map((user) => {
              const locked =
                user.lockedUntil && new Date(user.lockedUntil) > new Date();
              return (
                <Tr
                  key={user.id}
                  className={cn(!user.isActive && "text-muted-foreground")}
                >
                  <Td>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={user.fullName} />
                      <span className="min-w-0 leading-tight">
                        <span className="block font-medium">
                          {user.fullName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {user.email}
                        </span>
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <NativeSelect
                      className="h-7 text-xs"
                      value={user.role}
                      aria-label={`Role of ${user.fullName}`}
                      onChange={(e) =>
                        update.mutate({
                          id: user.id,
                          email: user.email,
                          body: { role: e.target.value },
                        })
                      }
                    >
                      <option value="student_only">Students only</option>
                      <option value="full">Students and staff</option>
                    </NativeSelect>
                  </Td>
                  <Td className="tabular text-muted-foreground">
                    {formatDateTime(user.lastLoginAt)}
                  </Td>
                  <Td>
                    {!user.isActive ? (
                      <Badge variant="muted">Deactivated</Badge>
                    ) : locked ? (
                      <Badge className="border-transparent bg-status-late-bg text-status-late">
                        Locked until {formatDateTime(user.lockedUntil)}
                      </Badge>
                    ) : user.mustChangePassword ? (
                      <Badge variant="outline">Must change password</Badge>
                    ) : (
                      <Badge className="border-transparent bg-status-onsite-bg text-status-onsite">
                        Active
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${user.fullName}`}
                        >
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() =>
                            update.mutate({
                              id: user.id,
                              email: user.email,
                              body: { resetPassword: true },
                            })
                          }
                        >
                          <KeyRoundIcon /> Reset password
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant={user.isActive ? "destructive" : "default"}
                          onSelect={() =>
                            update.mutate({
                              id: user.id,
                              email: user.email,
                              body: { isActive: !user.isActive },
                            })
                          }
                        >
                          {user.isActive ? (
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
              );
            })}
          </Table>
        )}
      </Panel>

      <Note>
        Resetting a password or deactivating an account ends that person's open
        sessions immediately. You cannot deactivate or demote your own account —
        ask another administrator, so nobody can lock themselves out by
        accident.
      </Note>
    </Section>
  );
}
