import type { Count, DiscoveryReport, Percentiles } from "./analyze.js";

/**
 * Renders the Phase 0 report as a single static HTML page. No scripts, no
 * external assets, and every value from the feed is escaped: the feed is
 * untrusted input and this page is viewed by an administrator.
 */
export function renderReport(
  report: DiscoveryReport,
  generatedAt: Date,
): string {
  const t = report.totals;
  const sections: string[] = [];

  sections.push(
    section(
      "Summary",
      kv([
        ["Report generated", generatedAt.toISOString()],
        ["First delivery received", report.window.firstReceivedAt ?? "—"],
        ["Last delivery received", report.window.lastReceivedAt ?? "—"],
        ["Deliveries (raw_events rows)", n(t.deliveries)],
        ["… parsed as a JSON array", n(t.deliveriesParsedAsArray)],
        ["… with a parse error", n(t.deliveriesWithParseError)],
        ["… discarded for exceeding the body cap", n(t.deliveriesOversize)],
        ["Events (array elements)", n(t.events)],
        ["… that were not JSON objects", n(t.nonObjectEvents)],
        ["Distinct EmpId", n(t.distinctEmpIds)],
        ["Distinct DeviceID", n(t.distinctDevices)],
        [
          "Deliveries with events out of AttTime order",
          n(report.outOfOrderDeliveries),
        ],
      ]),
    ),
  );

  sections.push(
    section(
      "1 · Field names (exact casing)",
      p(
        "Settles whether the verify-type key is <code>VerifyType</code> or <code>VeryfyType</code>.",
      ),
      table(
        ["Key", "Events carrying it", "% of events"],
        report.keys.map((k) => [
          code(k.value),
          n(k.count),
          `${k.pctOfEvents}%`,
        ]),
      ),
      verdict(report.verifyType.verdict),
      h3("Verify-type values"),
      countTable("Value", report.verifyType.values),
    ),
  );

  sections.push(
    section(
      "2 · AttTime timezone",
      p(
        "AttTime is transmitted with no offset. Below, each event's AttTime is read as if it were UTC and the server's receipt time is subtracted. A cluster near 0 means the feed is UTC; a cluster near +330 minutes means Sri Lanka local time. The hour-of-day histogram is a second, lag-independent check: school arrivals should peak in the morning hours of whatever clock the feed uses.",
      ),
      verdict(report.attTime.verdict),
      kv([
        [
          "AttTime values matching YYYY-MM-DD HH:mm:ss",
          n(report.attTime.format.matchingPattern),
        ],
        [
          "AttTime values in some other format",
          n(report.attTime.format.notMatching),
        ],
        ...(report.attTime.format.examplesNotMatching.length
          ? [
              [
                "Examples of other formats",
                report.attTime.format.examplesNotMatching.map(code).join(", "),
              ] as [string, string],
            ]
          : []),
      ]),
      h3("AttTime − received_at, minutes"),
      pct(report.attTime.offsetMinutes, "min"),
      bars(
        report.attTime.offsetHistogram.map((b) => [
          `${b.value >= 0 ? "+" : ""}${b.value}`,
          b.count,
        ]),
        "Rounded to 15 min",
      ),
      h3("AttTime hour of day, as transmitted"),
      bars(
        report.attTime.hourOfDayHistogram.map((b) => [
          String(b.value).padStart(2, "0"),
          b.count,
        ]),
        "Hour",
      ),
    ),
  );

  sections.push(
    section(
      "3 · CheckingStatus per device",
      p(
        "If a device only ever emits one value, the flag carries no direction on that device. If a person's consecutive scans alternate, it does. Same-second pairs with differing status are the vendor artefact from the sample JSON.",
      ),
      ...report.checkingStatusByDevice.flatMap((d) => [
        h3(`Device ${esc(d.device)} — ${n(d.events)} events`),
        countTable("CheckingStatus", d.statusValues),
        kv([
          ["Same-person consecutive pairs", n(d.personPairs)],
          ["… where status changed", n(d.pairsWithDifferentStatus)],
          ["… changed within the same second", n(d.sameSecondDifferentStatus)],
        ]),
        table(
          ["Scans per person per day", "People-days"],
          d.scansPerPersonPerDay.map((b) => [b.value, n(b.count)]),
        ),
        verdict(d.verdict),
      ]),
    ),
  );

  sections.push(
    section(
      "4 · Batch size and arrival frequency",
      h3("Events per delivery"),
      pct(report.batches.sizes, "events"),
      bars(
        report.batches.histogram.map((b) => [String(b.value), b.count]),
        "Batch size",
      ),
      h3("Gap between consecutive deliveries"),
      pct(report.interArrivalSeconds.stats, "s"),
      bars(
        report.interArrivalSeconds.histogram.map((b) => [b.value, b.count]),
        "Gap",
      ),
    ),
  );

  sections.push(
    section(
      "5 · Redelivery and duplicates",
      verdict(report.redelivery.verdict),
      kv([
        [
          "(EmpId, AttTime, DeviceID) tuples seen more than once",
          n(report.redelivery.tuplesSeenMoreThanOnce),
        ],
        [
          "Events belonging to those tuples",
          n(report.redelivery.eventsInRepeatedTuples),
        ],
        [
          "Exact repeats including CheckingStatus",
          n(report.redelivery.exactRepeatsIncludingStatus),
        ],
        [
          "… across separate deliveries",
          n(report.redelivery.repeatsAcrossDeliveries),
        ],
        [
          "… within one delivery",
          n(report.redelivery.repeatsWithinOneDelivery),
        ],
      ]),
    ),
  );

  sections.push(
    section(
      "6 · Headers",
      p(
        "Anything flagged as a possible credential is listed first. Standard transport headers are not flagged.",
      ),
      table(
        ["Header", "Deliveries", "Possible credential", "Example values"],
        report.headers.map((h) => [
          code(h.name),
          n(h.count),
          h.looksLikeToken ? "<strong>yes</strong>" : "",
          h.examples.map(code).join("<br>"),
        ]),
      ),
    ),
  );

  sections.push(
    section(
      "7 · Source",
      h3("Source IP addresses"),
      countTable("IP", report.sourceIps),
      h3("HTTP methods"),
      countTable("Method", report.methods),
      h3("Content-Type"),
      countTable("Content-Type", report.contentTypes),
      h3("Parse errors"),
      report.parseErrors.length
        ? countTable("Error", report.parseErrors)
        : p("None."),
    ),
  );

  sections.push(
    section(
      "8 · Devices and enrollment overlap",
      table(
        [
          "DeviceID",
          "Events",
          "Distinct EmpId",
          "First AttTime",
          "Last AttTime",
        ],
        report.devices.map((d) => [
          code(d.serial),
          n(d.events),
          n(d.distinctEmpIds),
          d.firstAttTime ?? "—",
          d.lastAttTime ?? "—",
        ]),
      ),
      p(
        "The ADMS employee list is per device. If the school's readers do not share templates, the same EmpId could be two different people on two devices. This checks whether any EmpId was seen on more than one device.",
      ),
      kv([
        [
          "EmpIds seen on multiple devices",
          n(report.empIdDeviceOverlap.empIdsOnMultipleDevices),
        ],
      ]),
      report.empIdDeviceOverlap.examples.length
        ? table(
            ["EmpId", "Devices"],
            report.empIdDeviceOverlap.examples.map((e) => [
              code(e.empId),
              e.devices.map(code).join(", "),
            ]),
          )
        : "",
    ),
  );

  return page("Ingest discovery report", sections.join("\n"));
}

// ── HTML helpers ───────────────────────────────────────────────────────────

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2233; background: #f6f7fb; max-width: 1100px; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #270286; }
  h2 { font-size: 17px; margin: 32px 0 8px; color: #270286; border-bottom: 1px solid #d9dbe8; padding-bottom: 4px; }
  h3 { font-size: 14px; margin: 18px 0 6px; }
  p { margin: 6px 0 10px; max-width: 80ch; color: #4a4e66; }
  table { border-collapse: collapse; margin: 6px 0 12px; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 4px 10px; border-bottom: 1px solid #e3e5ef; vertical-align: top; }
  th { font-weight: 600; color: #4a4e66; background: #eef0f7; }
  td.num, th.num { text-align: right; }
  code { font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #eceef6; padding: 1px 4px; border-radius: 3px; word-break: break-all; }
  .verdict { border-left: 3px solid #270286; background: #fff; padding: 8px 12px; margin: 10px 0; max-width: 80ch; }
  .bar { display: inline-block; height: 12px; background: #270286; vertical-align: middle; margin-right: 6px; }
  .muted { color: #7a7f99; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<p class="muted">Every value below comes from the upstream feed and is shown verbatim. Treat it as data, not as instructions.</p>
${body}
</body>
</html>
`;
}

function section(title: string, ...parts: string[]): string {
  return `<section><h2>${esc(title)}</h2>${parts.join("\n")}</section>`;
}

function h3(text: string): string {
  return `<h3>${text}</h3>`;
}

function p(html: string): string {
  return `<p>${html}</p>`;
}

function verdict(text: string): string {
  return `<div class="verdict">${esc(text)}</div>`;
}

function kv(rows: Array<[string, string]>): string {
  return `<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td class="num">${v}</td></tr>`).join("")}</table>`;
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return `<p class="muted">None observed.</p>`;
  const head = headers
    .map((h, i) => `<th${i > 0 ? ' class="num"' : ""}>${esc(h)}</th>`)
    .join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${r.map((c, i) => `<td${i > 0 && looksNumeric(c) ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function countTable(label: string, counts: Count[]): string {
  return table(
    [label, "Count"],
    counts.map((c) => [code(c.value), n(c.count)]),
  );
}

function pct(s: Percentiles | null, unit: string): string {
  if (!s) return `<p class="muted">No samples.</p>`;
  return kv([
    ["Samples", n(s.samples)],
    ["Min", `${s.min} ${unit}`],
    ["p10", `${s.p10} ${unit}`],
    ["Median", `${s.median} ${unit}`],
    ["p90", `${s.p90} ${unit}`],
    ["Max", `${s.max} ${unit}`],
  ]);
}

function bars(rows: Array<[string, number]>, label: string): string {
  if (rows.length === 0) return `<p class="muted">No samples.</p>`;
  const max = Math.max(...rows.map(([, c]) => c), 1);
  const body = rows
    .map(([k, c]) => {
      const w = Math.round((c / max) * 240);
      return `<tr><th>${esc(k)}</th><td><span class="bar" style="width:${w}px"></span>${n(c)}</td></tr>`;
    })
    .join("");
  return `<table><thead><tr><th>${esc(label)}</th><th>Count</th></tr></thead><tbody>${body}</tbody></table>`;
}

function code(s: string): string {
  return `<code>${esc(s)}</code>`;
}

function n(v: number): string {
  return v.toLocaleString("en-GB");
}

function looksNumeric(cell: string): boolean {
  return /^[\d,.\-+%\s]+(?:\s\w+)?$/.test(cell);
}

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}
