import { showsLate } from "@/components/status.js";
import type { RegisterRow, StatusCounts } from "@/lib/api.js";
import { formatTime, NO_TIME, STATUS_PRESENTATION } from "@/lib/format.js";

/**
 * The register as it goes on paper, or into a PDF.
 *
 * The screen's table is virtualised — only the rows in view exist in the
 * document — so printing it would print a dozen people and call it the
 * day. This is the same rows, all of them, as a plain table the browser
 * can break across pages, hidden on screen and shown only in print.
 *
 * It prints what the screen shows: the day, the group and the status
 * chosen, in the order chosen. The header above it says which, so a
 * sheet on somebody's desk cannot be mistaken for the whole school.
 */
export function RegisterPrintSheet({
  rows,
  counts,
}: {
  rows: RegisterRow[];
  counts: StatusCounts | undefined;
}) {
  return (
    <section className="hidden print:block">
      {counts && (
        <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1 border-b border-black/15 pb-2 text-[0.8125rem]">
          <Figure label="Expected" value={counts.expected} />
          <Figure label="Present" value={counts.on_site} />
          <Figure label="Departed" value={counts.departed} />
          <Figure label="Late" value={counts.late} />
          <Figure label="Absent" value={counts.absent} />
          <Figure label="Not arrived" value={counts.pending} />
        </dl>
      )}

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-black/30">
            <Th className="w-[30%]">Name</Th>
            <Th className="w-[9%]">ID</Th>
            <Th className="w-[15%]">Group</Th>
            <Th className="w-[13%]">Category</Th>
            <Th className="w-[9%] text-right">First in</Th>
            <Th className="w-[9%] text-right">Last out</Th>
            <Th className="w-[15%]">Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.personId} className="border-b border-black/10">
              <Td>{row.fullName}</Td>
              <Td className="tabular">{row.enrollNo}</Td>
              <Td>{row.groupName ?? "—"}</Td>
              <Td>{row.category ?? "—"}</Td>
              <Td className="tabular text-right">{formatTime(row.firstIn)}</Td>
              <Td className="tabular text-right">
                {row.lastOut ? formatTime(row.lastOut) : NO_TIME}
              </Td>
              <Td>
                {STATUS_PRESENTATION[row.status].label}
                {showsLate(row.branch) && row.isLate && row.status !== "late"
                  ? " · Late"
                  : ""}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <p className="mt-3 text-[0.8125rem]">
          Nobody matches this day and these filters.
        </p>
      )}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-black/60">{label}</dt>
      <dd className="tabular font-semibold">{value}</dd>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`py-1 pr-2 text-[0.6875rem] font-semibold tracking-wide text-black/60 uppercase ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`py-1 pr-2 align-top ${className ?? ""}`}>{children}</td>
  );
}
