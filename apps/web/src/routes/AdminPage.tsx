import { useState } from "react";
import { AdminUsers } from "../components/admin/AdminUsers.js";
import { AdminRules } from "../components/admin/AdminRules.js";
import { AdminCalendar } from "../components/admin/AdminCalendar.js";
import { AdminAudit } from "../components/admin/AdminAudit.js";
import { AdminFailures } from "../components/admin/AdminFailures.js";
import { AdminDirectory } from "../components/admin/AdminDirectory.js";
import { AdminDevices } from "../components/admin/AdminDevices.js";
import { AdminUnknownIds } from "../components/admin/AdminUnknownIds.js";

/**
 * Administration.
 *
 * The test for this screen is whether the school can run the system without
 * ringing a developer: add a member of staff, mark a holiday, change the
 * late threshold, attach an unrecognised card, see who changed what, and
 * retry a delivery that failed.
 */

const SECTIONS = [
  { id: "directory", label: "People", element: <AdminDirectory /> },
  { id: "unknown", label: "Unknown IDs", element: <AdminUnknownIds /> },
  { id: "devices", label: "Devices", element: <AdminDevices /> },
  { id: "calendar", label: "Calendar", element: <AdminCalendar /> },
  { id: "rules", label: "Rules", element: <AdminRules /> },
  { id: "users", label: "Users", element: <AdminUsers /> },
  { id: "audit", label: "Audit log", element: <AdminAudit /> },
  { id: "failures", label: "Failed events", element: <AdminFailures /> },
] as const;

export function AdminPage() {
  const [active, setActive] =
    useState<(typeof SECTIONS)[number]["id"]>("directory");

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label="Admin sections"
        className="w-44 shrink-0 overflow-auto border-r border-neutral-200 bg-white py-2"
      >
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            onClick={() => setActive(section.id)}
            aria-current={active === section.id}
            className={`block w-full px-3 py-1.5 text-left text-sm transition-colors ${
              active === section.id
                ? "bg-brand-50 font-medium text-brand-700"
                : "text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {SECTIONS.find((s) => s.id === active)?.element}
      </div>
    </div>
  );
}
