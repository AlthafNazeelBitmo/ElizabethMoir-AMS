import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip as ChartTip,
  XAxis,
} from "recharts";

/** The morning's arrivals, ten minutes a bucket. Loaded lazily. */
export default function ArrivalsSparkline({
  series,
}: {
  series: Array<{ label: string; count: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={series}
                margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="arrivals" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--primary)"
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--primary)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" hide />
                <ChartTip
                  cursor={{ stroke: "var(--border)" }}
                  content={({ active, payload }) =>
                    active && payload?.[0] ? (
                      <div className="rounded-md border bg-popover px-2 py-1 text-xs shadow-md">
                        <span className="tabular font-medium">
                          {payload[0].payload.label}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {payload[0].value} arrived
                        </span>
                      </div>
                    ) : null
                  }
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="var(--primary)"
                  strokeWidth={1.5}
                  fill="url(#arrivals)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
  );
}
