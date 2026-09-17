import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDate } from "@/lib/format.js";

export interface DailyDay {
  date: string;
  present: number;
  absent: number;
  late: number;
  expected: number;
}

/** Present and absent per school day, stacked. Loaded lazily. */
export default function DailyChart({ days }: { days: DailyDay[] }) {
  const data = days.map((d) => ({
    ...d,
    label: formatDate(d.date).replace(/^\w+ /, ""),
    rate:
      d.expected > 0 ? Math.round((d.present / d.expected) * 1000) / 10 : null,
  }));
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
          barCategoryGap="30%"
          maxBarSize={40}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            allowDecimals={false}
          />
          <ChartTip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={({ active, payload }) => {
              const d = payload?.[0]?.payload as
                (typeof data)[number] | undefined;
              if (!active || !d) return null;
              return (
                <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                  <div className="font-medium">{formatDate(d.date)}</div>
                  <div className="tabular mt-0.5 text-muted-foreground">
                    <span className="text-status-onsite">
                      {d.present} present
                    </span>{" "}
                    ·{" "}
                    <span className="text-status-absent">
                      {d.absent} absent
                    </span>{" "}
                    · <span className="text-status-late">{d.late} late</span>
                    {d.rate !== null && ` · ${d.rate}%`}
                  </div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="present"
            stackId="a"
            fill="var(--status-onsite)"
            radius={[0, 0, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="absent"
            stackId="a"
            fill="var(--status-absent)"
            fillOpacity={0.55}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

