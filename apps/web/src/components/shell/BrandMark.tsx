import { useState } from "react";
import { BRAND } from "@/lib/branding.js";
import { schoolLogoVersion } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/**
 * The school's mark.
 *
 * If a crest has been uploaded (Admin → Rules) it is shown, from the API,
 * versioned so a new upload appears at once and an unchanged one is cached.
 * Otherwise the monogram shipped with the code stands in, and if even that
 * cannot load, a tile in the banner red carries the school's initials.
 *
 * The sign-in page has no session and so does not know whether a crest
 * has been uploaded. It shows the shipped monogram at once and asks the API
 * quietly; if there is an uploaded crest it takes over once it has loaded,
 * so nothing blinks while the question is answered.
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
  // undefined: not known (before sign-in) — ask. null: known to be absent.
  const version =
    givenVersion !== undefined ? givenVersion : schoolLogoVersion();
  // What asking found, where the version is not known.
  const [probe, setProbe] = useState<"pending" | "found" | "missing">(
    "pending",
  );
  const [shippedFailed, setShippedFailed] = useState(false);
  const initials = name ? initialsOf(name) : null;

  const uploadedSrc = `/api/school/logo${version ? `?v=${version}` : ""}`;
  const showUploaded =
    version !== null &&
    probe !== "missing" &&
    (version !== undefined || probe === "found");

  const dimensions = {
    default: "size-8 text-[0.6875rem]",
    lg: "size-11 text-base",
    xl: "size-20 text-2xl",
  }[size];

  if (showUploaded || !shippedFailed) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-md",
          showUploaded && "bg-card",
          dimensions,
          className,
        )}
      >
        {showUploaded ? (
          <img
            src={uploadedSrc}
            alt=""
            className="size-full object-contain"
            onError={() => setProbe("missing")}
          />
        ) : (
          <img
            src={BRAND.monogram}
            alt=""
            className="size-full object-contain"
            onError={() => setShippedFailed(true)}
          />
        )}
        {version === undefined && probe === "pending" && (
          <img
            src={uploadedSrc}
            alt=""
            className="hidden"
            onLoad={() => setProbe("found")}
            onError={() => setProbe("missing")}
          />
        )}
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
