import { Navigate, useParams } from "react-router-dom";
import { AdminAudit } from "@/components/admin/AdminAudit.js";
import { AdminCalendar } from "@/components/admin/AdminCalendar.js";
import { AdminDevices } from "@/components/admin/AdminDevices.js";
import { AdminDirectory } from "@/components/admin/AdminDirectory.js";
import { AdminFailures } from "@/components/admin/AdminFailures.js";
import { AdminGroups } from "@/components/admin/AdminGroups.js";
import { AdminRules } from "@/components/admin/AdminRules.js";
import { AdminUnknownIds } from "@/components/admin/AdminUnknownIds.js";
import { AdminUsers } from "@/components/admin/AdminUsers.js";

/**
 * Administration.
 *
 * The test for this screen is whether the school can run the system without
 * ringing a developer: add a member of staff, mark a holiday, change the
 * late threshold, attach an unrecognised card, see who changed what, and
 * retry a delivery that failed.
 *
 * Each section is a route of its own, so it can be linked to and comes
 * back after a reload. The section list lives in the sidebar.
 */
const SECTIONS: Record<string, () => React.JSX.Element> = {
  people: AdminDirectory,
  groups: AdminGroups,
  unknown: AdminUnknownIds,
  devices: AdminDevices,
  calendar: AdminCalendar,
  rules: AdminRules,
  users: AdminUsers,
  audit: AdminAudit,
  failures: AdminFailures,
};

export function AdminPage() {
  const { section = "people" } = useParams();
  const Component = SECTIONS[section];
  if (!Component) return <Navigate to="/admin/people" replace />;
  return <Component />;
}
