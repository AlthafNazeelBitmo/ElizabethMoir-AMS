import { useMutation } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Field } from "@/components/ui/misc.js";
import { api, ApiError } from "@/lib/api.js";

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
    // Every session ends with the change, this one included, so the sign-in
    // page follows — and it has to say why, or the person tries the old
    // password, fails, and locks themselves out working out what happened.
    onSuccess: () =>
      navigate("/login", {
        replace: true,
        state: { notice: "Your password was changed. Sign in with the new one." },
      }),
  });

  const problems =
    mutation.error instanceof ApiError ? mutation.error.problems : [];
  const message =
    mutation.error instanceof ApiError ? mutation.error.message : null;

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form
        className="w-full max-w-sm rounded-2xl border bg-card p-7 shadow-lg shadow-black/5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <KeyRoundIcon className="size-5" />
          </div>
          <h1 className="text-base font-semibold tracking-tight">
            Choose a new password
          </h1>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          At least 12 characters. Length matters more than symbols — a few
          unrelated words makes a better password than one word with
          substitutions.
        </p>

        <div className="space-y-4">
          <Field label="Current password">
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="h-9"
            />
          </Field>
          <Field label="New password">
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={12}
              className="h-9"
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
          size="lg"
          className="mt-6 w-full"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Saving…" : "Change password"}
        </Button>
      </form>
    </div>
  );
}
