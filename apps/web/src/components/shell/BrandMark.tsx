import { useState } from "react";
import { schoolLogoVersion } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/**
 * The school's mark.
 *
 * If a crest has been uploaded (Admin → Rules) it is shown, from the API,
 * versioned so a new upload appears at once and an unchanged one is cached.
 * Otherwise a tile in the banner red carries the school's initials —
 * recognisably theirs without a file having to exist. The sign-in page has
 * no session and so no version; it simply asks, and falls back if there is
 * nothing.
 */
export function BrandMark({
  name,
  size = "default",
  className,
  version: givenVersion,
}: {
  /** The school's name, for the initials. Omitted before sign-in. */
  name?: string;
  size?: "default" | "lg" | "xl";
  className?: string;
  /** The crest version, when the caller tracks it; otherwise the profile's. */
  version?: string | null | undefined;
}) {
  // undefined: not known (before sign-in) — try. null: known to be absent.
  const version = givenVersion !== undefined ? givenVersion : schoolLogoVersion();
  const [failed, setFailed] = useState(false);
  const initials = name ? initialsOf(name) : null;

  const dimensions = {
    default: "size-8 text-[0.6875rem]",
    lg: "size-11 text-base",
    xl: "size-20 text-2xl",
  }[size];

  if (version !== null && !failed) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-card",
          dimensions,
          className,
        )}
      >
        <img
          src={`/api/school/logo${version ? `?v=${version}` : ""}`}
          alt=""
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-brand font-semibold tracking-wider text-brand-foreground shadow-xs",
        dimensions,
        className,
      )}
    >
      {initials ?? (
        <svg
          viewBox="0 0 24 24"
          className="size-[55%]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <path d="M4 12h4l2-5 4 10 2-5h4" />
        </svg>
      )}
    </span>
  );
}

function initialsOf(name: string): string {
  const words = name
    .split(/\s+/)
    .filter((w) => w.length > 0 && !/^(of|the|and|for|de|la)$/i.test(w));
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join("") || name.slice(0, 2).toUpperCase();
}
