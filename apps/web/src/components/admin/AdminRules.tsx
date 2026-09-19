import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Field, Separator, Skeleton } from "@/components/ui/misc.js";
import { api } from "@/lib/api.js";
import { SchoolMark } from "./SchoolMark.js";
import { Panel, Problem, Section } from "./shared.js";

interface SettingsResponse {
  settings: {
    school_name: string;
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
      toast.success("Rules saved", {
        description: "Every figure computed from now on uses them.",
      });
      void queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
      // The shell reads the name and timezone from its own query.
      void queryClient.invalidateQueries({ queryKey: ["school"] });
    },
  });

  if (!draft) {
    return (
      <Section title="Rules">
        <Skeleton className="h-64 max-w-xl" />
      </Section>
    );
  }

  const statusMapText = JSON.stringify(draft.checking_status_map);

  return (
    <Section
      title="Rules"
      description="These decide what counts as late, what counts as one movement, and which day a scan belongs to. Changing them changes every figure computed afterwards."
    >
      <Problem error={save.error} />

      <form
        className="grid gap-4 xl:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            school_name: draft.school_name,
            timezone: draft.timezone,
            late_threshold_default: draft.late_threshold_default,
            duplicate_window_seconds: draft.duplicate_window_seconds,
            day_rollover_time: draft.day_rollover_time,
            absence_decided_after: draft.absence_decided_after,
            checking_status_map: draft.checking_status_map,
          });
        }}
      >
        <Panel title="The school" className="p-0">
          <div className="space-y-4 p-4">
            <SchoolMark />

            <Field
              label="School name"
              hint="Printed at the top of every report, and the name of the browser tab."
            >
              <Input
                value={draft.school_name}
                maxLength={100}
                required
                onChange={(e) =>
                  setDraft({ ...draft, school_name: e.target.value })
                }
              />
            </Field>

            <Field
              label="Timezone"
              hint="The readers send times with no offset, so this decides what those times mean. Confirm it against the discovery report before quoting any late or absent figure."
            >
              <Input
                value={draft.timezone}
                className="font-mono"
                onChange={(e) =>
                  setDraft({ ...draft, timezone: e.target.value })
                }
              />
            </Field>
          </div>
        </Panel>

        <Panel title="The day" className="p-0">
          <div className="space-y-4 p-4">
            <Field
              label="Late after"
              hint="An arrival after this counts as late. A group can override it."
            >
              <Input
                type="time"
                className="tabular w-40"
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
              <Input
                type="time"
                className="tabular w-40"
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
              <Input
                type="time"
                className="tabular w-40"
                value={draft.day_rollover_time ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, day_rollover_time: e.target.value })
                }
              />
            </Field>
          </div>
        </Panel>

        <Panel title="The readers" className="p-0 xl:col-span-2">
          <div className="grid gap-4 p-4 xl:grid-cols-2">
            <Field
              label="Repeat tap window (seconds)"
              hint="Two scans on the same reader within this many seconds count as one movement. People tap twice."
            >
              <Input
                type="number"
                min={1}
                max={3600}
                className="tabular w-40"
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
              <Input
                className="font-mono"
                defaultValue={statusMapText}
                onBlur={(e) => {
                  try {
                    const parsed: unknown = JSON.parse(e.target.value || "{}");
                    if (typeof parsed === "object" && parsed !== null) {
                      setDraft({
                        ...draft,
                        checking_status_map: parsed as Record<
                          string,
                          "in" | "out"
                        >,
                      });
                    }
                  } catch {
                    // Left for the server to reject with a readable message.
                  }
                }}
              />
            </Field>
          </div>
        </Panel>

        <div className="flex items-center gap-2 xl:col-span-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save rules"}
          </Button>
          <Separator orientation="vertical" className="h-5" />
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
