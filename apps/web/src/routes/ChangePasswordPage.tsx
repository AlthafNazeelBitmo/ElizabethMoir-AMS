import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Field, inputClass } from "../components/primitives.js";
import { api, ApiError } from "../lib/api.js";

/**
 * A new account must change its password before doing anything else.
 * Changing it ends every session including this one, so the user signs in
 * again afterwards — that is deliberate, not a rough edge.
 */
export function ChangePasswordPage() {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/api/auth/change-password", { currentPassword, newPassword }),
    onSuccess: () => navigate("/login", { replace: true }),
  });

  const problems =
    mutation.error instanceof ApiError ? mutation.error.problems : [];
  const message =
    mutation.error instanceof ApiError ? mutation.error.message : null;

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form
        className="w-full max-w-sm rounded border border-neutral-200 bg-white p-6"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <h1 className="mb-1 text-base font-semibold text-brand-700">
          Choose a new password
        </h1>
        <p className="mb-5 text-sm text-neutral-500">
          At least 12 characters. Length matters more than symbols — a few
          unrelated words makes a better password than one word with
          substitutions.
        </p>

        <div className="space-y-3">
          <Field label="Current password">
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </Field>
          <Field label="New password">
            <input
              className={inputClass}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={12}
            />
          </Field>
        </div>

        {message && (
          <div role="alert" className="mt-3 text-sm text-status-absent">
            <p>{message}</p>
            {problems.length > 0 && (
              <ul className="mt-1 list-inside list-disc">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          className="mt-5 w-full justify-center"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Saving…" : "Change password"}
        </Button>
      </form>
    </div>
  );
}
