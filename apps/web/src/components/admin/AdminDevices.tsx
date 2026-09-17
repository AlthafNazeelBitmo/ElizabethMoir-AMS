import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanLineIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/states.js";
import { Input, NativeSelect } from "@/components/ui/input.js";
import { Checkbox, Skeleton } from "@/components/ui/misc.js";
import { api } from "@/lib/api.js";
import {
  formatDateTime,
  Note,
  Panel,
  Problem,
  Section,
  Table,
  Td,
  Th,
  Tr,
} from "./shared.js";

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-devices"] });
      toast.success("Reader updated");
    },
  });

  return (
    <Section
      title="Devices"
      description="The readers, as they appear the first time they send a scan. Telling the system which way a reader faces makes every direction from it certain instead of inferred."
    >
      <Problem error={update.error} />

      {devices.isPending && <Skeleton className="h-32 w-full" />}

      {devices.isSuccess && devices.data.devices.length === 0 && (
        <Panel>
          <EmptyState
            icon={ScanLineIcon}
            title="No readers have sent anything yet."
            detail="One will appear here the first time it does."
          />
        </Panel>
      )}

      {devices.isSuccess && devices.data.devices.length > 0 && (
        <Panel>
          <Table
            head={
              <>
                <Th>Serial</Th>
                <Th>Label</Th>
                <Th>Direction</Th>
                <Th>Trust its status flag</Th>
                <Th>Last seen</Th>
              </>
            }
          >
            {devices.data.devices.map((device) => (
              <Tr key={device.id}>
                <Td className="tabular font-medium">{device.serial}</Td>
                <Td>
                  <Input
                    className="w-44"
                    defaultValue={device.label ?? ""}
                    placeholder="Front gate"
                    aria-label={`Label for ${device.serial}`}
                    onBlur={(e) => {
                      if (e.target.value !== (device.label ?? "")) {
                        update.mutate({
                          id: device.id,
                          body: { label: e.target.value || null },
                        });
                      }
                    }}
                  />
                </Td>
                <Td>
                  <NativeSelect
                    value={device.direction}
                    aria-label={`Direction of ${device.serial}`}
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
                  </NativeSelect>
                </Td>
                <Td>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox
                      checked={device.trustCheckingStatus}
                      onCheckedChange={(checked) =>
                        update.mutate({
                          id: device.id,
                          body: { trustCheckingStatus: checked === true },
                        })
                      }
                    />
                    {device.trustCheckingStatus ? "Trusted" : "Not trusted"}
                  </label>
                </Td>
                <Td className="tabular text-muted-foreground">
                  {formatDateTime(device.lastSeenAt)}
                </Td>
              </Tr>
            ))}
          </Table>
        </Panel>
      )}

      <Note>
        Only turn on "trust its status flag" once the discovery report shows
        that reader's CheckingStatus actually distinguishes arrivals from
        departures, and set the meaning of each value under Rules. Until then
        the system infers direction from the order of each person's scans, which
        is safer than believing a flag that might mean nothing.
      </Note>
    </Section>
  );
}
