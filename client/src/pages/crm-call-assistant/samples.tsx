import { Bot, PhoneIncoming, ShieldBan, User } from "lucide-react";
import type { ReactNode } from "react";
import { SamplePreview } from "@/components/sample-preview";
import { GoogleList, GoogleListRow, GooglePill } from "@/components/google";
import { StatusPill } from "@/components/crm-ui";
import { outcomeLabel, outcomeTone } from "./calls-shared";

/**
 * The Call Assistant's SAMPLE previews (components/sample-preview.tsx rules): shown only while the real
 * dataset is empty, built from these static fixtures, never stored or sent, never mixed with real rows.
 * Every value is obviously made up: "Sample caller", 555-010x numbers (the reserved fictional range),
 * "Sample City". The callers' words are the kind of thing a contractor's line hears, not a real call.
 */
const SAMPLE_NUMBER = { phone: "(555) 010-0100", label: "Sample main office", location: "Sample City, ST", forwardedFrom: "(555) 010-0199" } as const;

type SampleCall = { no: number; when: string; caller: string; phone: string; outcome: string; about: string; length: string };
const SAMPLE_CALLS: readonly SampleCall[] = [
  { no: 3, when: "Today 9:12 AM", caller: "Sample caller", phone: "(555) 010-0101", outcome: "lead_submitted", about: "Roof leak over the garage, wants an estimate this week", length: "2m 40s" },
  { no: 2, when: "Today 8:05 AM", caller: "Sample caller", phone: "(555) 010-0102", outcome: "alerted", about: "Water coming through the ceiling — asked for a person", length: "1m 05s" },
  { no: 1, when: "Yesterday 4:48 PM", caller: "Sample caller", phone: "(555) 010-0103", outcome: "info", about: "Asked whether you do gutter guards", length: "0m 52s" },
];
const SAMPLE_SPAM = { phone: "(555) 010-0100", status: "Blocked (auto)", strikes: 2, calls: 3, reason: "robocall", when: "Today 7:30 AM" } as const;

/** One number card, as the Numbers page shows it (numbers.tsx NumberCard) — with no real number yet. */
export function SampleNumbersPreview({ cta }: { cta?: ReactNode }) {
  return (
    <SamplePreview what="what a number looks like once you have one" cta={cta} testId="sample-preview-numbers">
      <GoogleList as="ul">
        <GoogleListRow as="li" size="md" testId="sample-number"
          title={<span className="tabular-nums">{SAMPLE_NUMBER.phone}</span>}
          badges={<StatusPill tone="success">Active</StatusPill>}
          meta={[SAMPLE_NUMBER.label, SAMPLE_NUMBER.location, `forwarded from ${SAMPLE_NUMBER.forwardedFrom}`]}
          line="Bought Jan 1 · can be released any time · included"
          actions={<><GooglePill size="sm" label="Edit" /><GooglePill size="sm" variant="quiet" label="Release" /></>}
        />
      </GoogleList>
    </SamplePreview>
  );
}

/** Three calls, as the Calls log and the Overview's Recent list show them — with no real call yet. */
export function SampleCallsPreview({ cta, compact }: { cta?: ReactNode; compact?: boolean }) {
  const rows = compact ? SAMPLE_CALLS.slice(0, 2) : SAMPLE_CALLS;
  return (
    <SamplePreview what="what your calls look like once the assistant answers one" cta={cta} testId="sample-preview-calls">
      <GoogleList as="ul">
        {rows.map((c) => (
          <GoogleListRow as="li" size="md" key={c.no} testId={`sample-call-${c.no}`}
            leading={<PhoneIncoming aria-hidden="true" />}
            title={<span>{c.caller} <span className="tabular-nums g-text-2">· {c.phone}</span></span>}
            badges={<StatusPill tone={outcomeTone(c.outcome)}>{outcomeLabel(c.outcome)}</StatusPill>}
            meta={[c.about, c.when, c.length]}
          />
        ))}
      </GoogleList>
    </SamplePreview>
  );
}

/** One screened number, as the Spam blocked ledger shows it — with nothing screened yet. */
export function SampleSpamPreview({ cta }: { cta?: ReactNode }) {
  return (
    <SamplePreview what="what a screened number looks like" cta={cta} testId="sample-preview-spam">
      <GoogleList as="ul">
        <GoogleListRow as="li" size="md" testId="sample-spam-entry"
          leading={<ShieldBan aria-hidden="true" />}
          title={<span>Sample caller <span className="tabular-nums g-text-2">· {SAMPLE_SPAM.phone}</span></span>}
          badges={<StatusPill tone="danger">{SAMPLE_SPAM.status}</StatusPill>}
          meta={[`blocked: ${SAMPLE_SPAM.reason}`, `${SAMPLE_SPAM.strikes} strikes`, `${SAMPLE_SPAM.calls} calls`, `last call ${SAMPLE_SPAM.when}`]}
          actions={<GooglePill size="sm" variant="quiet" label="Unblock" />}
        />
      </GoogleList>
    </SamplePreview>
  );
}

/** A short typed exchange, as the Simulator shows one — before a test call is started. */
export function SampleConversationPreview({ cta }: { cta?: ReactNode }) {
  const lines: Array<{ role: "assistant" | "caller"; text: string; badge?: string }> = [
    { role: "assistant", text: "Thanks for calling Sample Roofing Co., this is the virtual assistant. What can we help with today?" },
    { role: "caller", text: "I think I have a leak over the garage." },
    { role: "assistant", text: "Sorry to hear that. What's the address of the house?", badge: "Continue · slot: need" },
  ];
  return (
    <SamplePreview what="what a test call looks like" cta={cta} testId="sample-preview-simulator">
      <div className="space-y-2">
        {lines.map((m, i) => (
          <div key={i} className={m.role === "caller" ? "flex justify-end gap-2" : "flex justify-start gap-2"} data-testid={`sample-sim-message-${i}`}>
            {m.role === "assistant" && <Bot className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
            <div className={m.role === "caller" ? "max-w-[80%] rounded-2xl border bg-background px-3 py-2 text-sm" : "max-w-[80%] rounded-2xl bg-muted px-3 py-2 text-sm"}>
              <p>{m.text}</p>
              {m.badge && <span className="g-chip g-chip--sm mt-1.5 inline-flex">{m.badge}</span>}
            </div>
            {m.role === "caller" && <User className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          </div>
        ))}
      </div>
    </SamplePreview>
  );
}
