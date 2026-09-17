import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ScrollTextIcon,
} from "lucide-react";
import { useState } from "react";
import { EmptyState, TableSkeleton } from "@/components/states.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Input, NativeSelect } from "@/components/ui/input.js";
import { Avatar } from "@/components/ui/misc.js";
import { api } from "@/lib/api.js";
import { cn } from "@/lib/utils.js";
import { formatDateTime, Panel, Section, Table, Td, Th, Tr } from "./shared.js";

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

/** A tint per family of action, so a wall of entries can be skimmed. */
function actionTone(action: string): string {
  if (action.startsWith("login") || action === "logout" || action === "lockout")
    return "bg-muted text-muted-foreground";
  if (action.includes("export")) return "bg-status-late-bg text-status-late";
  if (action.includes("deactivated") || action.includes("dead_letter"))
    return "bg-status-absent-bg text-status-absent";
  return "bg-accent text-accent-foreground";
}

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
        <Button asChild variant="outline">
          <a href={exportUrl}>
            <DownloadIcon /> Export CSV
          </a>
        </Button>
      }
    >
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <NativeSelect
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
          </NativeSelect>
          <Input
            type="date"
            className="tabular w-[10.5rem]"
            aria-label="From date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
          <Input
            type="date"
            className="tabular w-[10.5rem]"
            aria-label="To date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
          {log.data && (
            <span className="tabular ml-auto text-xs text-muted-foreground">
              {log.data.total.toLocaleString("en-GB")} entries
            </span>
          )}
        </div>

        {log.isPending && <TableSkeleton rows={8} />}

        {log.isSuccess && log.data.entries.length === 0 && (
          <EmptyState
            icon={ScrollTextIcon}
            title="Nothing recorded for this filter yet."
          />
        )}

        {log.isSuccess && log.data.entries.length > 0 && (
          <>
            <Table
              head={
                <>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>Action</Th>
                  <Th>Subject</Th>
                  <Th className="text-right" />
                </>
              }
            >
              {log.data.entries.map((entry) => (
                <Tr key={entry.id} className="align-top">
                  <Td className="tabular text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                  </Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      {(entry.userName ?? entry.userEmail) && (
                        <Avatar
                          name={entry.userName ?? entry.userEmail ?? ""}
                          size="sm"
                        />
                      )}
                      {entry.userName ?? entry.userEmail ?? "—"}
                    </span>
                  </Td>
                  <Td>
                    <Badge
                      className={cn(
                        "border-transparent",
                        actionTone(entry.action),
                      )}
                    >
                      {entry.action.replace(/_/g, " ")}
                    </Badge>
                  </Td>
                  <Td className="text-muted-foreground">
                    {entry.entity ?? "—"}
                    {entry.entityId && (
                      <span className="tabular ml-1 text-xs opacity-70">
                        {entry.entityId.slice(0, 8)}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    {(entry.before !== null || entry.after !== null) && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() =>
                          setExpanded(expanded === entry.id ? null : entry.id)
                        }
                      >
                        {expanded === entry.id ? "Hide" : "Detail"}
                      </Button>
                    )}
                    {expanded === entry.id && (
                      <pre className="mt-2 max-h-72 max-w-md overflow-auto rounded-md border bg-muted/50 p-2 text-left font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap">
                        {JSON.stringify(
                          { before: entry.before, after: entry.after },
                          null,
                          2,
                        )}
                      </pre>
                    )}
                  </Td>
                </Tr>
              ))}
            </Table>

            <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-sm">
              <span className="tabular text-muted-foreground">
                Page {page} of {pages}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeftIcon /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next <ChevronRightIcon />
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>
    </Section>
  );
}
