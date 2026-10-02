import { EmptyState } from "@/components/crm-ui";
import { MessageSquareText } from "lucide-react";

/**
 * Simulator tab — a text chat against the compiled profile through the app
 * (POST /api/crm/voice/simulator/*), showing each turn's decision (action,
 * slots, alerts) beside the reply; later the fake-call button.
 * OWNER: studio-frontend lane (LANES.md).
 */
export function SimulatorPanel() {
  return (
    <div data-testid="panel-call-assistant-simulator" className="pt-4">
      <EmptyState
        icon={MessageSquareText}
        title="Simulator"
        description="Call your assistant by typing: the same brain a caller gets, with every decision shown. Coming from the studio lane."
      />
    </div>
  );
}
