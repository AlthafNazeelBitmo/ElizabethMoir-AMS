import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../primitives.js";
import { api } from "../../lib/api.js";
import { Problem, Section, Table, formatDateTime } from "./shared.js";

interface Device {
  id: number;
  serial: string;
  label: string | null;
  location: string | null;
  direction: "entry" | "exit" | "both";
  trustCheckingStatus: boolean;
  isActive: boolean;
  lastSeenAt: string | null;
}

/**
 * The readers.
 *
 * A device's direction is the highest-confidence way to know whether a scan
 * is an arrival or a departure, and only somebody who has seen where the
 * reader is mounted can set it. Everything else falls back to inferring
 * from the order of a person's scans.
 */
export function AdminDevices() {
  const queryClient = useQueryClient();

  const devices = useQuery({
    queryKey: ["admin-devices"],
    queryFn: () => api.get<{ devices: Device[] }>("/api/admin/devices"),
  });

  const update = useMutation({
    mutationFn: (args: { id: number; body: Record<string, unknown> }) =>
      api.patch(`/api/admin/devices/${args.id}`, args.body),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["admin-devices"] }),
  });

  return (
    <Section
      title="Devices"
      description="The readers, as they appear the first time they send a scan. Telling the system which way a reader faces makes every direction from it certain instead of inferred."
    >
      <Problem error={update.error} />

      {devices.isPending && (
        <p className="text-sm text-neutral-500">Loading…</p>
      )}

      {devices.isSuccess && devices.data.devices.length === 0 && (
        <p className="text-sm text-neutral-500">
          No readers have sent anything yet. One will appear here the first time
          it does.
        </p>
      )}

      {devices.isSuccess && devices.data.devices.length > 0 && (
        <Table
          head={
            <>
              <th className="py-2">Serial</th>
              <th className="py-2">Label</th>
              <th className="py-2">Direction</th>
              <th className="py-2">Trust its status flag</th>
              <th className="py-2">Last seen</th>
            </>
          }
        >
          {devices.data.devices.map((device) => (
            <tr key={device.id} className="border-b border-neutral-100">
              <td className="tabular py-2">{device.serial}</td>
              <td className="py-2">
                <input
                  className="w-40 rounded border border-neutral-300 px-1.5 py-1 text-sm"
                  defaultValue={device.label ?? ""}
                  placeholder="Front gate"
                  onBlur={(e) => {
                    if (e.target.value !== (device.label ?? "")) {
                      update.mutate({
                        id: device.id,
                        body: { label: e.target.value || null },
                      });
                    }
                  }}
                />
              </td>
              <td className="py-2">
                <select
                  className="rounded border border-neutral-300 bg-white px-1.5 py-1 text-sm"
                  value={device.direction}
                  onChange={(e) =>
                    update.mutate({
                      id: device.id,
                      body: { direction: e.target.value },
                    })
                  }
                >
                  <option value="both">Both ways (infer from order)</option>
                  <option value="entry">Entry only</option>
                  <option value="exit">Exit only</option>
                </select>
              </td>
              <td className="py-2">
                <label className="flex items-center gap-1.5 text-sm text-neutral-600">
                  <input
                    type="checkbox"
                    checked={device.trustCheckingStatus}
                    onChange={(e) =>
                      update.mutate({
                        id: device.id,
                        body: { trustCheckingStatus: e.target.checked },
                      })
                    }
                  />
                  {device.trustCheckingStatus ? "Trusted" : "Not trusted"}
                </label>
              </td>
              <td className="py-2 text-neutral-500">
                {formatDateTime(device.lastSeenAt)}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <p className="mt-4 max-w-2xl text-xs text-neutral-500">
        Only turn on "trust its status flag" once the discovery report shows
        that reader's CheckingStatus actually distinguishes arrivals from
        departures, and set the meaning of each value under Rules. Until then
        the system infers direction from the order of each person's scans, which
        is safer than believing a flag that might mean nothing.
      </p>
    </Section>
  );
}
