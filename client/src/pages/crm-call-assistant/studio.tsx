import { EmptyState } from "@/components/crm-ui";
import { Sparkles } from "lucide-react";

/**
 * Agent Studio tab — the setup wizard on first run, then the advanced editor
 * with every shared/voice-profile.ts section (company, service area with the
 * county picker + region shortcuts, credibility, offers, policies, persona
 * with sample playback, intake script, FAQ, escalations, lead delivery,
 * appointments, advanced), the prompt preview, version history and Publish.
 * OWNER: studio-frontend lane (LANES.md). API: /api/crm/voice/profile*,
 * /counties, /personas (server/voice/profile.ts).
 */
export function StudioPanel({ canManage }: { canManage: boolean }) {
  return (
    <div data-testid="panel-call-assistant-studio" className="pt-4">
      <EmptyState
        icon={Sparkles}
        title="Agent Studio"
        description={canManage
          ? "Describe your company, service area, policies and the questions your assistant asks; preview the prompt; publish. Coming from the studio lane."
          : "Only members who manage settings can edit the assistant."}
      />
    </div>
  );
}
