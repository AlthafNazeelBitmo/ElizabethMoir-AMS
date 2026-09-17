import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BrandMark } from "@/components/shell/BrandMark.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Field } from "@/components/ui/misc.js";
import { api, ApiError, type CurrentUser } from "@/lib/api.js";

/**
 * Sign in. The school's name is not known until a session exists, so this
 * screen is the one place that says "Attendance" and nothing more.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ user: CurrentUser }>("/api/auth/login", { email, password }),
    onSuccess: (data) => {
      navigate(
        data.user.mustChangePassword ? "/change-password" : "/register",
        {
          replace: true,
        },
      );
    },
  });

  const message =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.isError
        ? "The server could not be reached. Check your connection and try again."
        : null;

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden p-4">
      {/* A quiet field of the accent behind the card; never a photograph. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60rem 30rem at 50% -10%, color-mix(in oklch, var(--primary) 16%, transparent), transparent 70%)",
        }}
      />
      <form
        className="w-full max-w-sm rounded-2xl border bg-card p-7 shadow-lg shadow-black/5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="mb-6 flex items-center gap-3">
          <BrandMark size="lg" />
          <div>
            <h1 className="text-base font-semibold tracking-tight">
              Attendance
            </h1>
            <p className="text-sm text-muted-foreground">
              Sign in to see the register.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <Field label="Email">
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="h-9"
            />
          </Field>

          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-9"
            />
          </Field>
        </div>

        {message && (
          <p role="alert" className="mt-3 text-sm text-status-absent">
            {message}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          className="mt-6 w-full"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
