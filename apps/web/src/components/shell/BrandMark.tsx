import { useState } from "react";
import { BRAND } from "@/lib/branding.js";
import { schoolLogoVersion } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/**
 * The school's mark, in two sizes of intent.
 *
 * `SchoolLogo` is the whole logo — monogram, rules, banner — for the top
 * of the sidebar and the head of a printed report. `BrandMark` is the
 * monogram alone, for the places a small square tile is all there is room
 * for: the collapsed rail, the sign-in form.
 *
 * Both prefer a crest the school has uploaded (Admin → Rules), served by
 * the API and versioned so a new upload appears at once. Failing that, the
 * files shipped with the code. Failing even those, a tile in the banner
 * red with the school's initials.
 *
 * The sign-in page has no session and so does not know whether a crest
 * has been uploaded. It shows the shipped file at once and asks the API
 * quietly; an uploaded crest takes over once it has loaded, so nothing
 * blinks while the question is answered.
 */

type Probe = "pending" | "found" | "missing";

function useUploadedMark(givenVersion: string | null | undefined) {
  // undefined: not known (before sign-in) — ask. null: known to be absent.
  const version =
    givenVersion !== undefined ? givenVersion : schoolLogoVersion();
  const [probe, setProbe] = useState<Probe>("pending");
  const src = `/api/school/logo${version ? `?v=${version}` : ""}`;
  const show =
    version !== null &&
    probe !== "missing" &&
    (version !== undefined || probe === "found");
  // Rendered while the answer is not known: display:none still loads.
  const probeImage =
    version === undefined && probe === "pending" ? (
      <img
        src={src}
        alt=""
        className="hidden"
        onLoad={() => setProbe("found")}
        onError={() => setProbe("missing")}
      />
    ) : null;
  return { show, src, probeImage, missing: () => setProbe("missing") };
}

export function SchoolLogo({
  className,
  version,
}: {
  className?: string;
  version?: string | null | undefined;
}) {
  const uploaded = useUploadedMark(version);
  const [shippedFailed, setShippedFailed] = useState(false);

  if (uploaded.show) {
    return (
      <span className={cn("flex items-center justify-center", className)}>
        <img
          src={uploaded.src}
          alt={BRAND.name}
          className="max-h-full max-w-full object-contain"
          onError={uploaded.missing}
        />
        {uploaded.probeImage}
      </span>
    );
  }

  if (!shippedFailed) {
    return (
      <span className={cn("flex items-center justify-center", className)}>
        <img
          src={BRAND.logo}
          alt={BRAND.name}
          width={622}
          height={246}
          style={{ aspectRatio: BRAND.logoAspect }}
          className="max-h-full w-full max-w-full object-contain"
          draggable={false}
          onError={() => setShippedFailed(true)}
        />
        {uploaded.probeImage}
      </span>
    );
  }

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <InitialsTile name={BRAND.name} className="size-9 text-xs" />
      <span className="text-sm font-semibold tracking-tight">{BRAND.name}</span>
    </span>
  );
}

export function BrandMark({
  name,
  size = "default",
  className,
  version,
}: {
  /** The school's name, for the initials. Omitted before sign-in. */
  name?: string;
  size?: "default" | "lg" | "xl";
  className?: string;
  /** The crest version, when the caller tracks it; otherwise the profile's. */
  version?: string | null | undefined;
}) {
  const uploaded = useUploadedMark(version);
  const [shippedFailed, setShippedFailed] = useState(false);

  const dimensions = {
    default: "size-8 text-[0.6875rem]",
    lg: "size-11 text-base",
    xl: "size-20 text-2xl",
  }[size];

  if (uploaded.show || !shippedFailed) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-md",
          uploaded.show && "bg-card",
          dimensions,
          className,
        )}
      >
        {uploaded.show ? (
          <img
            src={uploaded.src}
            alt=""
            className="size-full object-contain"
            onError={uploaded.missing}
          />
        ) : (
          <img
            src={BRAND.monogram}
            alt=""
            className="size-full object-contain"
            draggable={false}
            onError={() => setShippedFailed(true)}
          />
        )}
        {uploaded.probeImage}
      </span>
    );
  }

  return (
    <InitialsTile
      name={name ?? BRAND.name}
      className={cn(dimensions, className)}
    />
  );
}

function InitialsTile({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-brand font-semibold tracking-wider text-brand-foreground shadow-xs",
        className,
      )}
    >
      {initialsOf(name)}
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
