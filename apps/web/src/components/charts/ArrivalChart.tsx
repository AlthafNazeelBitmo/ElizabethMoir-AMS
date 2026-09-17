import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as ChartTip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { PersonDay } from "@/lib/api.js";
import { formatDate, schoolTimezone } from "@/lib/format.js";

/** When they arrived, day by day: a late pattern is a shape, not a count. */
export default function ArrivalChart({ days }: { days: PersonDay[] }) {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: schoolTimezone(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const points = days
    .filter((d) => d.firstIn)
    .map((d, index) => {
      const [h, m] = clock.format(new Date(d.firstIn!)).split(":").map(Number);
      return {
        index,
        date: d.date,
        minutes: (h ?? 0) * 60 + (m ?? 0),
        late: d.isLate,
        label: formatDate(d.date),
      };
    });
  const min = Math.min(...points.map((p) => p.minutes));
  const max = Math.max(...points.map((p) => p.minutes));
  const pad = 20;
  const toClock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            type="number"
            dataKey="index"
            domain={[0, Math.max(points.length - 1, 1)]}
            tickFormatter={(i: number) =>
              points[i]?.label.replace(/^\w+ /, "") ?? ""
            }
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            type="number"
            dataKey="minutes"
            domain={[
              Math.floor((min - pad) / 10) * 10,
              Math.ceil((max + pad) / 10) * 10,
            ]}
            tickFormatter={toClock}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
            reversed
          />
          <ZAxis range={[36, 36]} />
          <ChartTip
            cursor={false}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as
                (typeof points)[number] | undefined;
              if (!active || !p) return null;
              return (
                <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                  <div className="font-medium">{p.label}</div>
                  <div className="tabular text-muted-foreground">
                    Arrived {toClock(p.minutes)}
                    {p.late ? " · late" : ""}
                  </div>
                </div>
              );
            }}
          />
          <Scatter
            data={points.filter((p) => !p.late)}
            fill="var(--status-onsite)"
            isAnimationActive={false}
          />
          <Scatter
            data={points.filter((p) => p.late)}
            fill="var(--status-late)"
            isAnimationActive={false}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

