/**
 * Sample previews for the CRM's empty lists — what each page looks like once it has real data.
 *
 * Every fixture here is static and obviously made up ("Sample Homeowner", "123 Example St"); nothing is
 * fetched, stored, sent or counted. Each block is wrapped in <SamplePreview> (badged "Sample data", inert,
 * dimmed) and the page renders it ONLY while its real dataset is empty — the moment one real row exists
 * the page shows the real list instead (CLAUDE.md: never fabricate data; owner 2026-10-15: a demo that
 * is replaced by real data so clients know what each feature is).
 */
import type { ReactNode } from "react";
import { Camera, Clock, Mail, MapPin, Phone, Video } from "lucide-react";
import { SamplePreview } from "@/components/sample-preview";
import { InitialAvatar, StatusPill, crmTable, crmTableCards, statusTone, type PillTone } from "@/components/crm-ui";
import { cn } from "@/lib/utils";

const money = (dollars: number) => `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const money0 = (dollars: number) => `$${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Three made-up clients, reused across the samples so the pages tell one story. */
const SAMPLE_CLIENTS = [
  { name: "Sample Homeowner", email: "sample@example.com", phone: "(555) 010-0101", address: "123 Example St, Sampleville, TX", bid: "sent" },
  { name: "Example Property Co.", email: "office@example.com", phone: "(555) 010-0102", address: "456 Placeholder Ave, Sampleville, TX", bid: "approved" },
  { name: "Demo Family", email: "", phone: "(555) 010-0103", address: "789 Mockup Rd, Sampleville, TX", bid: "none" },
] as const;

const BID_PILL: Record<string, { label: string; tone: PillTone }> = {
  sent: { label: "Bid out", tone: "info" },
  approved: { label: "Won", tone: "success" },
};

/* ── Clients ─────────────────────────────────────────────────────────────── */

export function SampleClientsTable({ cta }: { cta?: ReactNode }) {
  return (
    <SamplePreview what="what your client list looks like once you add a client" cta={cta} testId="sample-clients">
      <div className={crmTable.wrapper}>
        <table className={crmTable.table}>
          <thead className={`${crmTable.thead} ${crmTableCards.thead}`}>
            <tr>
              <th className={crmTable.th}>Client</th>
              <th className={crmTable.th}>Contact</th>
              <th className={`${crmTable.th} hidden sm:table-cell`}>Address</th>
              <th className={`${crmTable.th} hidden sm:table-cell`}>Bid</th>
              <th className={`${crmTable.th} hidden sm:table-cell`}>Added</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_CLIENTS.map((c) => (
              <tr key={c.name} className={`${crmTable.tr} ${crmTableCards.tr}`}>
                <td className={crmTableCards.td}>
                  <div className="flex items-center gap-3 min-w-0">
                    <InitialAvatar name={c.name} />
                    <span className="font-medium truncate">{c.name}</span>
                  </div>
                </td>
                <td className={crmTableCards.td}>
                  <div className="space-y-0.5 text-sm text-muted-foreground">
                    {c.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3 shrink-0" />{c.email}</div>}
                    <div className="flex items-center gap-1.5"><Phone className="h-3 w-3 shrink-0" />{c.phone}</div>
                  </div>
                </td>
                <td className={`${crmTable.td} hidden sm:table-cell`}>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="h-3 w-3 shrink-0" />{c.address}</div>
                </td>
                <td className={`${crmTable.td} hidden sm:table-cell`}>
                  {BID_PILL[c.bid] ? <StatusPill tone={BID_PILL[c.bid].tone}>{BID_PILL[c.bid].label}</StatusPill> : <span className="text-muted-foreground text-sm">—</span>}
                </td>
                <td className={`${crmTable.td} hidden sm:table-cell text-sm text-muted-foreground`}>Today</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SamplePreview>
  );
}

/* ── Pipeline ────────────────────────────────────────────────────────────── */

const SAMPLE_CARDS = [
  { stage: "Lead", name: "Roof replacement — Sample Homeowner", number: "P-0001", value: 18400, trades: ["Roofing"] },
  { stage: "Bid sent", name: "Siding + gutters — Example Property Co.", number: "P-0002", value: 26900, trades: ["Siding", "Gutters"] },
  { stage: "Approved", name: "Bathroom remodel — Demo Family", number: "P-0003", value: 9600, trades: ["Remodel"] },
];

export function SamplePipelineBoard({ cta }: { cta?: ReactNode }) {
  return (
    <SamplePreview what="what the board looks like once you add a lead" cta={cta} testId="sample-pipeline">
      <div className="flex gap-3 overflow-x-auto pb-1">
        {SAMPLE_CARDS.map((c) => (
          <div key={c.number} className="min-w-[240px] w-[240px] shrink-0">
            <div className="flex items-center justify-between px-1.5 pb-2">
              <span className="text-sm font-medium">{c.stage}</span>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">1</span>
            </div>
            <div className="rounded-xl border border-border/50 bg-muted/40 p-2">
              <div className="rounded-lg border bg-card p-3 space-y-1.5 shadow-sm">
                <div className="font-medium text-sm leading-snug">{c.name}</div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{c.number}</span>
                  <span className="text-sm font-semibold tabular-nums">{money0(c.value)}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.trades.map((t) => <span key={t} className="rounded-full border px-1.5 py-0.5 text-[10px]">{t}</span>)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </SamplePreview>
  );
}

/* ── Estimates / invoices ────────────────────────────────────────────────── */

const SAMPLE_DOCS = {
  estimates: [
    { number: "EST-0001", client: "Sample Homeowner", title: "Roof replacement", status: "sent", total: 18400 },
    { number: "EST-0002", client: "Example Property Co.", title: "Siding + gutters", status: "approved", total: 26900 },
    { number: "EST-0003", client: "Demo Family", title: "Bathroom remodel", status: "draft", total: 9600 },
  ],
  invoices: [
    { number: "INV-0001", client: "Example Property Co.", title: "Deposit — siding + gutters", status: "paid", total: 8070 },
    { number: "INV-0002", client: "Sample Homeowner", title: "Roof replacement", status: "sent", total: 18400 },
    { number: "INV-0003", client: "Demo Family", title: "Bathroom remodel — progress", status: "partial", total: 4800 },
  ],
} as const;

export function SampleDocsTable({ kind, cta }: { kind: "estimates" | "invoices"; cta?: ReactNode }) {
  const rows = SAMPLE_DOCS[kind];
  const noun = kind === "estimates" ? "an estimate" : "an invoice";
  return (
    <SamplePreview what={`what this list looks like once you send ${noun}`} cta={cta} testId={`sample-${kind}`}>
      <div className={crmTable.wrapper}>
        <table className={crmTable.table}>
          <thead className={crmTable.thead}>
            <tr>
              <th className={crmTable.th}>Number</th>
              <th className={cn(crmTable.th, "hidden sm:table-cell")}>Client</th>
              <th className={cn(crmTable.th, "hidden md:table-cell")}>Title</th>
              <th className={cn(crmTable.th, "hidden sm:table-cell")}>Status</th>
              <th className={crmTable.thRight}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.number} className={crmTable.tr}>
                <td className={crmTable.td}>
                  <span className="font-medium text-primary whitespace-nowrap">{r.number}</span>
                  <div className="sm:hidden text-xs text-muted-foreground">{r.client}</div>
                </td>
                <td className={cn(crmTable.td, "hidden sm:table-cell")}>{r.client}</td>
                <td className={cn(crmTable.td, "hidden md:table-cell")}>{r.title}</td>
                <td className={cn(crmTable.td, "hidden sm:table-cell")}><StatusPill tone={statusTone(r.status)}>{r.status}</StatusPill></td>
                <td className={cn(crmTable.tdRight, "whitespace-nowrap")}>{money(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SamplePreview>
  );
}

/* ── Payments ────────────────────────────────────────────────────────────── */

const SAMPLE_PAYMENTS = [
  { amount: 8070, method: "Bank transfer (ACH)", purpose: "Deposit", client: "Example Property Co.", doc: "Invoice INV-0001", status: "succeeded" },
  { amount: 4800, method: "Card", purpose: "Progress payment", client: "Demo Family", doc: "Invoice INV-0003", status: "succeeded" },
  { amount: 1500, method: "Check", purpose: "Deposit", client: "Sample Homeowner", doc: "Estimate EST-0001", status: "succeeded" },
];

export function SamplePaymentsList({ cta }: { cta?: ReactNode }) {
  return (
    <SamplePreview what="what this list looks like once a client pays" cta={cta} testId="sample-payments">
      <div className="space-y-2">
        {SAMPLE_PAYMENTS.map((p) => (
          <div key={p.doc} className="rounded-lg border bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium tabular-nums">
                {money(p.amount)}
                <span className="text-muted-foreground font-normal text-sm"> · {p.method} · {p.purpose}</span>
              </div>
              <div className="text-sm truncate"><span className="font-medium">{p.client}</span><span className="text-muted-foreground"> · {p.doc}</span></div>
              <div className="text-xs text-muted-foreground">Today</div>
            </div>
            <StatusPill tone={statusTone(p.status)}>{p.status}</StatusPill>
          </div>
        ))}
      </div>
    </SamplePreview>
  );
}

/* ── Schedule (agenda) ───────────────────────────────────────────────────── */

const SAMPLE_VISITS = [
  { day: "Tomorrow", title: "Roof inspection", time: "8:00 AM – 9:00 AM", where: "Roof replacement · P-0001", crew: "Sample Crew Lead" },
  { day: "Tomorrow", title: "Material drop-off", time: "1:00 PM – 2:00 PM", where: "Siding + gutters · P-0002", crew: "Sample Installer" },
  { day: "In 3 days", title: "Install day 1", time: "All day", where: "Siding + gutters · P-0002", crew: "Sample Crew Lead, Sample Installer" },
];

export function SampleScheduleList({ cta }: { cta?: ReactNode }) {
  const days = [...new Set(SAMPLE_VISITS.map((v) => v.day))];
  return (
    <SamplePreview what="what the agenda looks like once a visit is booked" cta={cta} testId="sample-schedule">
      <div className="space-y-4">
        {days.map((d) => (
          <section key={d}>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-1 pb-2">{d}</h3>
            <div className="space-y-2">
              {SAMPLE_VISITS.filter((v) => v.day === d).map((v) => (
                <div key={v.title} className="rounded-xl border bg-card p-3.5">
                  <div className="font-medium text-sm leading-snug">{v.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {v.time}</span>
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {v.where}</span>
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground">Crew: {v.crew}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </SamplePreview>
  );
}

/* ── Messages ────────────────────────────────────────────────────────────── */

const SAMPLE_THREADS = [
  { name: "Sample Homeowner", when: "2h ago", last: "Can the crew start Tuesday instead of Monday?", unread: 1 },
  { name: "Example Property Co.", when: "Yesterday", last: "You: The deposit receipt is in your portal.", unread: 0 },
  { name: "Demo Family", when: "3d ago", last: "Thanks — approved the bathroom estimate just now.", unread: 0 },
];

export function SampleInboxList({ cta }: { cta?: ReactNode }) {
  return (
    <SamplePreview what="what your messages look like once a client writes to you" cta={cta} testId="sample-inbox">
      <div className="flex flex-col gap-1 w-full md:w-80">
        {SAMPLE_THREADS.map((t) => (
          <div key={t.name} className={cn("rounded-lg border bg-card px-3 py-2.5", t.unread > 0 && "border-primary/40")}>
            <div className="flex items-center gap-2.5">
              <InitialAvatar name={t.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm", t.unread > 0 ? "font-semibold" : "font-medium")}>{t.name}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">{t.when}</span>
                </div>
                <div className={cn("text-xs truncate", t.unread > 0 ? "text-foreground" : "text-muted-foreground")}>{t.last}</div>
              </div>
              {t.unread > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs leading-5 text-center font-semibold shrink-0">{t.unread}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </SamplePreview>
  );
}

/* ── Measurement reports ─────────────────────────────────────────────────── */

const SAMPLE_REPORTS = [
  { file: "sample-roof-report.pdf", where: "123 Example St, Sampleville, TX", client: "Sample Homeowner", status: "confirmed", squares: "28.4" },
  { file: "Pasted report", where: "456 Placeholder Ave, Sampleville, TX", client: "Example Property Co.", status: "draft", squares: "41.0" },
];

export function SampleReportsTable({ cta }: { cta?: ReactNode }) {
  return (
    <SamplePreview what="what this list looks like once a report is imported" cta={cta} testId="sample-reports">
      <div className={crmTable.wrapper}>
        <table className={crmTable.table}>
          <thead className={crmTable.thead}>
            <tr>
              <th className={crmTable.th}>Report</th>
              <th className={cn(crmTable.th, "hidden sm:table-cell")}>Client</th>
              <th className={crmTable.th}>Status</th>
              <th className={crmTable.thRight}>Squares</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_REPORTS.map((r) => (
              <tr key={r.file} className={crmTable.tr}>
                <td className={crmTable.td}>
                  <div className="font-medium">{r.file}</div>
                  <div className="text-xs text-muted-foreground">{r.where}</div>
                </td>
                <td className={cn(crmTable.td, "hidden sm:table-cell")}>{r.client}</td>
                <td className={crmTable.td}><StatusPill tone={statusTone(r.status)}>{r.status}</StatusPill></td>
                <td className={crmTable.tdRight}>{r.squares}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SamplePreview>
  );
}

/* ── JobCam ──────────────────────────────────────────────────────────────── */

const SAMPLE_SHOTS = [
  { label: "Before — front elevation", kind: "photo", tag: "Before" },
  { label: "Tear-off, day 1", kind: "photo", tag: "Progress" },
  { label: "Walkthrough clip", kind: "video", tag: "Progress" },
  { label: "After — front elevation", kind: "photo", tag: "After" },
] as const;

/** No images: labelled tiles stand in for photos, so nothing can be mistaken for a real shot. */
export function SampleJobcamGrid({ cta }: { cta?: ReactNode }) {
  return (
    <SamplePreview what="what the feed looks like once the crew takes a photo" cta={cta} testId="sample-jobcam">
      <div className={cn("grid gap-2", "grid-cols-2 sm:grid-cols-4")}>
        {SAMPLE_SHOTS.map((s) => (
          <div key={s.label} className="aspect-square rounded-lg border bg-muted/60 p-2 flex flex-col justify-between">
            <div className="flex items-center justify-between text-muted-foreground">
              {s.kind === "video" ? <Video className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
              <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-medium">{s.tag}</span>
            </div>
            <div>
              <div className="text-xs font-medium leading-snug">{s.label}</div>
              <div className="text-[10px] text-muted-foreground">Sample job · 123 Example St</div>
            </div>
          </div>
        ))}
      </div>
    </SamplePreview>
  );
}
