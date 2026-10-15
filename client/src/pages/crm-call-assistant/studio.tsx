import { Section } from "@/components/app-ui";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/crm-ui";
import { apiErrorMessage } from "@/lib/queryClient";
import { callAssistantGateFrom } from "@/components/plan-required";
import { isFirstRun, type VoiceProfileResponse } from "@/lib/voice-studio";
import { PROFILE_KEY } from "./studio/api";
import { SetupWizard } from "./studio/wizard";
import { CallAssistantPlanRequired } from "./index";
import { StudioEditor } from "./studio/editor";
import { HowItWorks } from "./how-it-works";

/** The three steps of the studio, in a contractor's words (the wizard and the editor both do exactly this). */
const STUDIO_STEPS: ReadonlyArray<[string, string]> = [
  ["Tell it about your business", "Company, services and don'ts, service area, policies: it knows only what you type here and never invents a price or a license."],
  ["Pick a voice and the questions", "Choose a persona and name, and the questions it asks in order. Save draft keeps edits without changing the live assistant."],
  ["Publish, then test it", "Publish makes a numbered version live on every number forwarded to it; try it in the Simulator, and restore any version later."],
];

/**
 * Agent Studio tab — the setup wizard on first run (nothing published, setup
 * never completed), then the advanced editor with every profile section, the
 * prompt preview, version history and publish. OWNER: studio-frontend lane
 * (LANES.md). API: /api/crm/voice/profile*, /counties, /personas.
 */
export function StudioPanel({ canManage }: { canManage: boolean }) {
  const profile = useQuery<VoiceProfileResponse>({ queryKey: PROFILE_KEY });
  const [mode, setMode] = useState<"auto" | "wizard" | "editor">("auto");

  let body: React.ReactNode;
  if (profile.isLoading) {
    body = <div className="flex items-center gap-2 py-10 justify-center text-sm text-muted-foreground" data-testid="studio-loading"><Loader2 className="h-4 w-4 animate-spin" /> Loading your assistant…</div>;
  } else if (profile.isError && callAssistantGateFrom(profile.error)) {
    body = <div className="pt-4"><CallAssistantPlanRequired error={profile.error} /></div>;
  } else if (profile.isError || !profile.data) {
    const notReady = /^501:/.test(String((profile.error as any)?.message ?? ""));
    body = (
      <Section flush><CardContent className="p-0">
        <EmptyState icon={Sparkles} title={notReady ? "The Studio backend isn't wired up yet" : "Couldn't load the assistant"}
          description={notReady ? "The profile API answers 501 until the studio-backend lane lands. The editor is built and waiting." : apiErrorMessage(profile.error)} />
      </CardContent></Section>
    );
  } else {
    const showWizard = mode === "wizard" || (mode === "auto" && isFirstRun(profile.data));
    if (showWizard && !canManage) {
      body = (
        <Section flush><CardContent className="p-0">
          <EmptyState icon={Sparkles} title="Your assistant hasn't been set up yet"
            description="Only members who manage settings can run the setup. Ask an owner or admin to finish it in Agent Studio." />
        </CardContent></Section>
      );
    } else if (showWizard) {
      body = <SetupWizard initial={profile.data.profile} onDone={() => setMode("editor")} onSkip={() => setMode("editor")} />;
    } else {
      body = <StudioEditor key={profile.data.publishedVersion ?? "draft"} data={profile.data} canManage={canManage} onRunWizard={() => setMode("wizard")} />;
    }
  }

  const showHow = !!profile.data && !profile.isError;
  return (
    <div data-testid="panel-call-assistant-studio">
      {showHow && <HowItWorks className="mt-4" testId="how-studio-works" steps={STUDIO_STEPS} />}
      {body}
    </div>
  );
}
