import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Field, inputClass } from "../primitives.js";
import { api, type UserRole } from "../../lib/api.js";
import {
  OneTimePassword,
  Problem,
  Section,
  Table,
  formatDateTime,
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
          <Button variant="primary" onClick={() => setCreating(true)}>
            Add user
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
        <form
          className="mb-4 flex flex-wrap items-end gap-2 rounded border border-neutral-200 p-3"
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
            <input name="email" type="email" required className={inputClass} />
          </Field>
          <Field label="Full name">
            <input name="fullName" required className={inputClass} />
          </Field>
          <Field label="Role">
            <select
              name="role"
              className={inputClass}
              defaultValue="student_only"
            >
              <option value="student_only">Students only</option>
              <option value="full">Students and staff (admin)</option>
            </select>
          </Field>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
          <Button variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </form>
      )}

      <Problem error={create.error ?? update.error} />

      {users.isPending && <p className="text-sm text-neutral-500">Loading…</p>}

      {users.isSuccess && (
        <Table
          head={
            <>
              <th className="py-2">Email</th>
              <th className="py-2">Name</th>
              <th className="py-2">Role</th>
              <th className="py-2">Last signed in</th>
              <th className="py-2">Status</th>
              <th className="py-2" />
            </>
          }
        >
          {users.data.users.map((user) => (
            <tr key={user.id} className="border-b border-neutral-100">
              <td className="py-2">{user.email}</td>
              <td className="py-2 text-neutral-600">{user.fullName}</td>
              <td className="py-2">
                <select
                  className="rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs"
                  value={user.role}
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
                </select>
              </td>
              <td className="py-2 text-neutral-500">
                {formatDateTime(user.lastLoginAt)}
              </td>
              <td className="py-2">
                {!user.isActive ? (
                  <span className="text-neutral-500">Deactivated</span>
                ) : user.lockedUntil &&
                  new Date(user.lockedUntil) > new Date() ? (
                  <span className="text-status-late">
                    Locked until {formatDateTime(user.lockedUntil)}
                  </span>
                ) : user.mustChangePassword ? (
                  <span className="text-neutral-500">Must change password</span>
                ) : (
                  <span className="text-neutral-600">Active</span>
                )}
              </td>
              <td className="py-2">
                <div className="flex justify-end gap-1">
                  <Button
                    onClick={() =>
                      update.mutate({
                        id: user.id,
                        email: user.email,
                        body: { resetPassword: true },
                      })
                    }
                  >
                    Reset password
                  </Button>
                  <Button
                    onClick={() =>
                      update.mutate({
                        id: user.id,
                        email: user.email,
                        body: { isActive: !user.isActive },
                      })
                    }
                  >
                    {user.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <p className="mt-4 max-w-2xl text-xs text-neutral-500">
        Resetting a password or deactivating an account ends that person's open
        sessions immediately. You cannot deactivate or demote your own account —
        ask another administrator, so nobody can lock themselves out by
        accident.
      </p>
    </Section>
  );
}
