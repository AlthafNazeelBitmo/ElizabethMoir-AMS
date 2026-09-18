import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageUpIcon, Trash2Icon } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { BrandMark } from "@/components/shell/BrandMark.js";
import { Button } from "@/components/ui/button.js";
import { api, ApiError } from "@/lib/api.js";
import { schoolName, type SchoolProfile } from "@/lib/format.js";
import { Problem } from "./shared.js";

const ACCEPT = "image/png,image/jpeg,image/svg+xml,image/webp";
const MAX_BYTES = 512 * 1024;

/**
 * The school's crest, uploaded once and kept with the other school
 * settings. Shown in the sidebar and on the sign-in page; until one is
 * uploaded, a tile with the school's initials stands in.
 */
export function SchoolMark() {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  // The same query the shell reads, so both change together.
  const school = useQuery({
    queryKey: ["school"],
    queryFn: () => api.get<SchoolProfile>("/api/school"),
    staleTime: 5 * 60_000,
  });
  const version = school.data?.logoVersion ?? null;
  const hasLogo = version !== null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["school"] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_BYTES) {
        throw new ApiError(
          413,
          "too_large",
          `That file is ${Math.round(file.size / 1024)} KB; the mark must be under ${MAX_BYTES / 1024} KB.`,
        );
      }
      const csrf = /(?:^|;\s*)ams_csrf=([^;]+)/.exec(document.cookie)?.[1];
      const res = await fetch("/api/admin/school/logo", {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "content-type": file.type,
          ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {}),
        },
        body: file,
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (!res.ok) {
        throw new ApiError(
          res.status,
          body?.error ?? "error",
          body?.message ?? "The mark could not be saved.",
        );
      }
    },
    onSuccess: () => {
      toast.success("Mark updated", {
        description: "It is on the sidebar and the sign-in page now.",
      });
      void refresh();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete("/api/admin/school/logo"),
    onSuccess: () => {
      toast.success("Mark removed", {
        description: "The initials tile stands in again.",
      });
      void refresh();
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-medium leading-none text-muted-foreground">
        School mark
      </span>
      <div className="flex items-center gap-4">
        <BrandMark key={version ?? "none"} name={schoolName()} size="xl" version={version} />
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => input.current?.click()}
              disabled={upload.isPending}
            >
              <ImageUpIcon />
              {upload.isPending ? "Uploading…" : hasLogo ? "Replace" : "Upload"}
            </Button>
            {hasLogo && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                <Trash2Icon /> Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            PNG, JPEG, SVG or WebP, under 512 KB. A square crest with a clear
            background sits best in the sidebar.
          </p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        aria-label="Choose a mark"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />
      <Problem error={upload.error ?? remove.error} />
    </div>
  );
}
