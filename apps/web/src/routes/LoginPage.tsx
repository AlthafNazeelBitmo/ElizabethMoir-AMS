import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Field, inputClass } from "../components/primitives.js";
import { api, ApiError, type CurrentUser } from "../lib/api.js";

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
        { replace: true },
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
    <div className="flex h-full items-center justify-center bg-neutral-50 p-4">
      <form
        className="w-full max-w-sm rounded border border-neutral-200 bg-white p-6"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <h1 className="mb-1 text-base font-semibold text-brand-700">
          Attendance
        </h1>
        <p className="mb-5 text-sm text-neutral-500">
          Sign in to see the register.
        </p>

        <div className="space-y-3">
          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </Field>

          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
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
          variant="primary"
          className="mt-5 w-full justify-center"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
