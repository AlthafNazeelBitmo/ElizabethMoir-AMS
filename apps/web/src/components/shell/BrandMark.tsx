import { useState } from "react";
import { cn } from "@/lib/utils.js";

/**
 * The school's mark.
 *
 * If the school has dropped its crest into `public/branding/logo.svg` (or
 * `.png`), that is shown. Otherwise a tile in the banner red carries the
 * school's initials — recognisably theirs without a file having to exist.
 * The crest itself is never committed; it is the school's, not the code's.
 */
export function BrandMark({
  name,
  size = "default",
  className,
}: {
  /** The school's name, for the initials. Omitted before sign-in. */
  name?: string;
  size?: "default" | "lg";
  className?: string;
}) {
  const [source, setSource] = useState<"svg" | "png" | "none">("svg");
  const initials = name ? initialsOf(name) : null;

  const dimensions =
    size === "lg" ? "size-11 text-base" : "size-7 text-[0.6875rem]";

  if (source !== "none") {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-card",
          dimensions,
          className,
        )}
      >
        <img
          src={`/branding/logo.${source}`}
          alt=""
          className="size-full object-contain"
          onError={() => setSource(source === "svg" ? "png" : "none")}
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
