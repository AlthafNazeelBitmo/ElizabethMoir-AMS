import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useId, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { api, ApiError, type CurrentUser } from "@/lib/api.js";
import { BRAND } from "@/lib/branding.js";

/**
 * Sign in.
 *
 * Two panels in one card: the school's field on the left — its crest, its
 * colours, one line about what this is — and the form on the right, which
 * asks for exactly two things and nothing else. There is no sign-up and no
 * "continue with": accounts are made by the office, and the page says so
 * rather than leaving a visitor looking for a button that is not there.
 * Behind the card, the crest's colours out of focus with the mark faint in
 * them: a backdrop made for this page, not a photograph of somewhere else.
 *
 * On a phone the field becomes a band across the top, so the crest is
 * still the first thing seen and the form is still reachable without
 * scrolling.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const emailId = useId();
  const passwordId = useId();

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ user: CurrentUser }>("/api/auth/login", { email, password }),
    onSuccess: (data) => {
      // Whoever was signed in before is gone: nothing cached under their
      // name may be shown to the person signing in now.
      queryClient.clear();
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
    <div className="relative flex h-full items-center justify-center overflow-y-auto bg-[color-mix(in_oklch,var(--crest-mist)_45%,var(--background))] p-3 sm:p-6 dark:bg-background">
      {/* The backdrop, and in the dark a veil over it so the card still
          leads. Both fixed to the frame, not the scrolling content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${BRAND.signInBackdrop})` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 dark:bg-background/80"
      />
      <div className="relative grid w-full max-w-[64rem] overflow-hidden rounded-[1.75rem] border border-white/60 bg-card shadow-2xl shadow-[color-mix(in_oklch,var(--crest-deep)_22%,transparent)] animate-in fade-in-0 slide-in-from-bottom-2 duration-300 md:min-h-[36rem] md:grid-cols-[1.08fr_1fr] md:p-4 dark:border-border">
        {/* The field */}
        <aside className="crest-field relative flex flex-col justify-between overflow-hidden p-6 text-white md:rounded-[1.25rem] md:p-9">
          <img
            src={BRAND.monogramOnDark}
            alt=""
            width={179}
            height={179}
            className="relative size-16 md:size-24"
            draggable={false}
          />
          <div className="relative mt-10 max-w-sm md:mt-0">
            <p className="text-sm font-medium text-white/75">{BRAND.name}</p>
            <p className="mt-1.5 text-[1.375rem]/[1.2] font-semibold tracking-tight text-balance md:text-[1.875rem]/[1.15]">
              Know who is in, the moment they arrive.
            </p>
          </div>
        </aside>

        {/* The form */}
        <form
          className="flex flex-col justify-center px-6 py-8 sm:px-10 md:px-12 md:py-10"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <h1 className="text-[1.75rem]/[1.15] font-semibold tracking-tight">
            Sign in
          </h1>

          <div className="mt-8 space-y-5">
            <div className="flex flex-col gap-2">
              <label htmlFor={emailId} className="text-sm font-medium">
                Email
              </label>
              <Input
                id={emailId}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="h-11 px-3.5 text-[0.9375rem]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor={passwordId} className="text-sm font-medium">
                Password
              </label>
              <div className="relative">
                <Input
                  id={passwordId}
                  type={shown ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11 px-3.5 pr-11 text-[0.9375rem] tracking-wide"
                />
                <button
                  type="button"
                  aria-label={shown ? "Hide password" : "Show password"}
                  aria-pressed={shown}
                  onClick={() => setShown((s) => !s)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
                >
                  {shown ? (
                    <EyeOffIcon className="size-4" />
                  ) : (
                    <EyeIcon className="size-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {notice && !message && (
            <p
              role="status"
              className="mt-4 rounded-md bg-status-onsite-bg px-3 py-2 text-sm text-status-onsite"
            >
              {notice}
            </p>
          )}

          {message && (
            <p role="alert" className="mt-4 text-sm text-status-absent">
              {message}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            className="mt-7 h-11 w-full text-[0.9375rem] shadow-md shadow-primary/25"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Signing in…" : "Sign in"}
          </Button>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Accounts are created by the school office. Ask there if you need
            one, or if you have forgotten your password.
          </p>
        </form>
      </div>
    </div>
  );
}
