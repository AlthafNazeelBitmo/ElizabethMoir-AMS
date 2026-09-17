import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { inputClass } from "../primitives.js";
import { api } from "../../lib/api.js";
import { Section, Table, formatDateTime } from "./shared.js";

interface AuditEntry {
  id: number;
  action: string;
  entity: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
  userEmail: string | null;
  userName: string | null;
}

const PAGE_SIZE = 50;

/**
 * The audit log.
 *
 * Append-only, enforced by the database rather than by this screen: there
 * is no edit or delete control here because there is no such path anywhere
 * in the system, for any role.
 */
export function AdminAudit() {
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);

  const filters = new URLSearchParams();
  if (action) filters.set("action", action);
  if (from) filters.set("from", from);
  if (to) filters.set("to", to);

  const query = new URLSearchParams(filters);
  query.set("page", String(page));
  query.set("limit", String(PAGE_SIZE));

  // The same filters as the screen, as a file. A plain link so the browser
  // downloads it under the name the server chose.
  const exportQuery = new URLSearchParams(filters);
  exportQuery.set("format", "csv");
  const exportUrl = `/api/admin/audit?${exportQuery.toString()}`;

  const log = useQuery({
    queryKey: ["admin-audit", query.toString()],
    queryFn: () =>
      api.get<{ entries: AuditEntry[]; total: number; actions: string[] }>(
        `/api/admin/audit?${query.toString()}`,
      ),
  });

  const pages = Math.max(1, Math.ceil((log.data?.total ?? 0) / PAGE_SIZE));

  return (
    <Section
      title="Audit log"
      description="Who did what, and when. Entries cannot be edited or removed by anyone, including administrators — the database refuses it."
      actions={
        <a
          href={exportUrl}
          className="inline-flex items-center rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Export CSV
        </a>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className={inputClass}
          aria-label="Filter by action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Every action</option>
          {(log.data?.actions ?? []).map((a) => (
            <option key={a} value={a}>
              {a.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input
          type="date"
          className={inputClass}
          aria-label="From date"
          value={from}
          max={to || undefined}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
        />
        <input
          type="date"
          className={inputClass}
          aria-label="To date"
          value={to}
          min={from || undefined}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
        />
        {log.data && (
          <span className="tabular text-xs text-neutral-500">
            {log.data.total} entries
          </span>
        )}
      </div>

      {log.isPending && <p className="text-sm text-neutral-500">Loading…</p>}

      {log.isSuccess && log.data.entries.length === 0 && (
        <p className="text-sm text-neutral-500">
          Nothing recorded for this filter yet.
        </p>
      )}

      {log.isSuccess && log.data.entries.length > 0 && (
        <>
          <Table
            head={
              <>
                <th className="py-2">When</th>
                <th className="py-2">Who</th>
                <th className="py-2">Action</th>
                <th className="py-2">Subject</th>
                <th className="py-2" />
              </>
            }
          >
            {log.data.entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-neutral-100 align-top"
              >
                <td className="py-1.5 whitespace-nowrap text-neutral-600">
                  {formatDateTime(entry.createdAt)}
                </td>
                <td className="py-1.5 text-neutral-600">
                  {entry.userName ?? entry.userEmail ?? "—"}
                </td>
                <td className="py-1.5">{entry.action.replace(/_/g, " ")}</td>
                <td className="py-1.5 text-neutral-500">
                  {entry.entity ?? "—"}
                  {entry.entityId ? ` ${entry.entityId.slice(0, 8)}` : ""}
                </td>
                <td className="py-1.5 text-right">
                  {(entry.before !== null || entry.after !== null) && (
                    <button
                      className="text-xs text-brand-700 hover:underline"
                      onClick={() =>
                        setExpanded(expanded === entry.id ? null : entry.id)
                      }
                    >
                      {expanded === entry.id ? "Hide" : "Detail"}
                    </button>
                  )}
                  {expanded === entry.id && (
                    <pre className="mt-1 max-w-md overflow-auto rounded bg-neutral-50 p-2 text-left text-xs text-neutral-700">
                      {JSON.stringify(
                        { before: entry.before, after: entry.after },
                        null,
                        2,
                      )}
                    </pre>
                  )}
                </td>
              </tr>
            ))}
          </Table>

          <div className="mt-3 flex items-center gap-2 text-sm">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded border border-neutral-300 px-2 py-1 disabled:text-neutral-400"
            >
              Previous
            </button>
            <span className="tabular text-neutral-600">
              Page {page} of {pages}
            </span>
            <button
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-neutral-300 px-2 py-1 disabled:text-neutral-400"
            >
              Next
            </button>
          </div>
        </>
      )}
    </Section>
  );
}
