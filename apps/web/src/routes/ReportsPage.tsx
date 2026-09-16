import { EmptyState } from "../components/primitives.js";

/**
 * Phase 5. An honest placeholder rather than a half-working screen that
 * would have people quoting figures nobody has reconciled yet.
 */
export function ReportsPage() {
  return (
    <EmptyState
      title="Reports are not built yet."
      detail="Attendance summaries, CSV export and the print layout arrive in the next phase. The live register is on the previous tab."
    />
  );
}
