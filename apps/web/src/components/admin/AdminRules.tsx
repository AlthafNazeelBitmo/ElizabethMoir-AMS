import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, Field, inputClass } from "../primitives.js";
import { api } from "../../lib/api.js";
import { Problem, Section } from "./shared.js";

interface SettingsResponse {
  settings: {
    timezone: string;
    late_threshold_default: string | null;
    duplicate_window_seconds: number;
    day_rollover_time: string | null;
    checking_status_map: Record<string, "in" | "out">;
    absence_decided_after: string | null;
  };
  defaults: SettingsResponse["settings"];
}

/**
 * The attendance rules.
 *
 * Every figure the school quotes is computed from these, so each one says
 * plainly what it changes. They are not buried behind sensible-looking
 * defaults: the timezone in particular is a guess until the discovery run
 * confirms it, and the person changing it should know that.
 */
export function AdminRules() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SettingsResponse["settings"] | null>(null);
  const [saved, setSaved] = useState(false);

  const query = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.get<SettingsResponse>("/api/admin/settings"),
  });

  useEffect(() => {
    if (query.data) setDraft(query.data.settings);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch("/api/admin/settings", body),
    onSuccess: () => {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
      void queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
    },
  });

  if (!draft) {
    return (
      <Section title="Rules">
        <p className="text-sm text-neutral-500">Loading…</p>
      </Section>
    );
  }

  const statusMapText = JSON.stringify(draft.checking_status_map);

  return (
    <Section
      title="Attendance rules"
      description="These decide what counts as late, what counts as one movement, and which day a scan belongs to. Changing them changes every figure computed afterwards."
    >
      <Problem error={save.error} />
      {saved && <p className="my-2 text-sm text-brand-700">Saved.</p>}

      <form
        className="max-w-xl space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            timezone: draft.timezone,
            late_threshold_default: draft.late_threshold_default,
            duplicate_window_seconds: draft.duplicate_window_seconds,
            day_rollover_time: draft.day_rollover_time,
            absence_decided_after: draft.absence_decided_after,
            checking_status_map: draft.checking_status_map,
          });
        }}
      >
        <Field
          label="Timezone"
          hint="The readers send times with no offset, so this decides what those times mean. Confirm it against the discovery report before quoting any late or absent figure."
        >
          <input
            className={inputClass}
            value={draft.timezone}
            onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
          />
        </Field>

        <Field
          label="Late after"
          hint="An arrival after this counts as late. A group can override it."
        >
          <input
            type="time"
            className={inputClass}
            value={draft.late_threshold_default ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, late_threshold_default: e.target.value })
            }
          />
        </Field>

        <Field
          label="Absence decided after"
          hint="Nobody is marked absent before this time, so latecomers are not reported missing while they are still on their way."
        >
          <input
            type="time"
            className={inputClass}
            value={draft.absence_decided_after ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, absence_decided_after: e.target.value })
            }
          />
        </Field>

        <Field
          label="Day rolls over at"
          hint="Scans before this time count towards the previous school day, so an event finishing after midnight does not open an empty new one."
        >
          <input
            type="time"
            className={inputClass}
            value={draft.day_rollover_time ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, day_rollover_time: e.target.value })
            }
          />
        </Field>

        <Field
          label="Repeat tap window (seconds)"
          hint="Two scans on the same reader within this many seconds count as one movement. People tap twice."
        >
          <input
            type="number"
            min={1}
            max={3600}
            className={inputClass}
            value={draft.duplicate_window_seconds}
            onChange={(e) =>
              setDraft({
                ...draft,
                duplicate_window_seconds: Number(e.target.value),
              })
            }
          />
        </Field>

        <Field
          label="Checking status meaning"
          hint='What each CheckingStatus value from the reader means. Leave empty until the discovery report shows the flag is trustworthy — an invented mapping produces confident, wrong arrival times. Example: {"0":"in","1":"out"}'
        >
          <input
            className={`${inputClass} font-mono`}
            defaultValue={statusMapText}
            onBlur={(e) => {
              try {
                const parsed: unknown = JSON.parse(e.target.value || "{}");
                if (typeof parsed === "object" && parsed !== null) {
                  setDraft({
                    ...draft,
                    checking_status_map: parsed as Record<string, "in" | "out">,
                  });
                }
              } catch {
                // Left for the server to reject with a readable message.
              }
            }}
          />
        </Field>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save rules"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => query.data && setDraft(query.data.defaults)}
          >
            Reset to defaults
          </Button>
        </div>
      </form>
    </Section>
  );
}
