import type { ReactNode } from "react";
import { SchoolLogo } from "@/components/shell/BrandMark.js";
import { formatDateTime, schoolName } from "@/lib/format.js";

/**
 * The head of a printed report. Hidden on screen, where the page header
 * and its controls do the same job.
 *
 * A sheet that leaves the building must explain itself with no screen
 * beside it: whose it is, what it is, what it covers, when it was made and
 * by whom. The logo is the school's, the same file the sidebar shows.
 */
export function PrintHeader({
  title,
  lines,
  preparedBy,
}: {
  title: string;
  /** What the report covers, one fact per line. */
  lines: ReactNode[];
  preparedBy?: string;
}) {
  return (
    <header className="mb-4 hidden items-end justify-between gap-6 border-b border-black/20 pb-3 print:flex">
      <SchoolLogo className="h-16 w-40 shrink-0 justify-start" />
      <div className="min-w-0 flex-1 text-right">
        <div className="text-[0.6875rem] font-medium tracking-wide text-black/60 uppercase">
          {schoolName()}
        </div>
        <h1 className="mt-0.5 text-lg leading-tight font-semibold tracking-tight text-black">
          {title}
        </h1>
        {lines.map((line, i) => (
          <div key={i} className="text-[0.8125rem] text-black/75">
            {line}
          </div>
        ))}
        <div className="mt-1 text-[0.6875rem] text-black/55">
          Prepared {formatDateTime(new Date())}
          {preparedBy ? ` by ${preparedBy}` : ""}
        </div>
      </div>
    </header>
  );
}
