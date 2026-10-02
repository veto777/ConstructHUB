import { recordingNoticeStates, type VoiceProfile } from "@shared/voice-profile";
import type { StudioSectionId } from "@/lib/voice-studio";
import { CompanySection, ServicesSection } from "./section-company";
import { ServiceAreaSection } from "./section-service-area";
import { CredibilitySection, OffersSection, PoliciesSection } from "./section-trust";
import { PersonaSection } from "./section-persona";
import { IntakeSection } from "./section-intake";
import { AdvancedSection, AppointmentsSection, EscalationsSection, FaqSection, LeadDeliverySection } from "./section-rest";

/**
 * One place that maps a section id to its editor, shared by the setup
 * wizard and the advanced editor so both edit the same draft the same way.
 * OWNER: studio-frontend lane.
 */
export function StudioSection({ id, draft, onChange, disabled }: {
  id: StudioSectionId; draft: VoiceProfile; onChange: (next: VoiceProfile) => void; disabled?: boolean;
}) {
  const patch = <K extends keyof VoiceProfile>(k: K, v: VoiceProfile[K]) => onChange({ ...draft, [k]: v });
  switch (id) {
    case "company": return <CompanySection value={draft.company} onChange={(v) => patch("company", v)} disabled={disabled} />;
    case "services": return <ServicesSection value={draft.company} onChange={(v) => patch("company", v)} disabled={disabled} />;
    case "serviceArea": return <ServiceAreaSection value={draft.serviceArea} onChange={(v) => patch("serviceArea", v)} disabled={disabled} />;
    case "credibility": return <CredibilitySection value={draft.credibility} onChange={(v) => patch("credibility", v)} disabled={disabled} />;
    case "offers": return <OffersSection value={draft.offers} onChange={(v) => patch("offers", v)} disabled={disabled} />;
    case "policies": return <PoliciesSection value={draft.policies} onChange={(v) => patch("policies", v)} disabled={disabled} />;
    case "persona": return <PersonaSection value={draft.persona} onChange={(v) => patch("persona", v)} disabled={disabled} companyName={draft.company.spokenName || draft.company.name} noticeStates={recordingNoticeStates(draft)} />;
    case "intake": return <IntakeSection value={draft.intake} onChange={(v) => patch("intake", v)} disabled={disabled} />;
    case "faq": return <FaqSection value={draft.faq} onChange={(v) => patch("faq", v)} disabled={disabled} />;
    case "escalations": return <EscalationsSection value={draft.escalations} onChange={(v) => patch("escalations", v)} disabled={disabled} />;
    case "leadDelivery": return <LeadDeliverySection value={draft.leadDelivery} onChange={(v) => patch("leadDelivery", v)} disabled={disabled} />;
    case "appointments": return <AppointmentsSection value={draft.appointments} onChange={(v) => patch("appointments", v)} disabled={disabled} />;
    case "advanced": return <AdvancedSection value={draft.advanced} onChange={(v) => patch("advanced", v)} disabled={disabled} />;
  }
}
