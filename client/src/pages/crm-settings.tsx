import { bundleRuleOf, bundleRuleText, orgDiscountRule } from "@shared/scope-category";
import { useEffect, useRef, useState } from "react";
import { ClientPageLayoutCard } from "@/components/client-page-layout";
import { JobFlowCard } from "@/components/job-flow-settings";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { HelpButton } from "@/components/help-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { CrmDivisionsManager } from "@/components/crm-divisions-manager";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { apiIssueMessage } from "@/lib/api-issue-message";
import { marketingUrl } from "@/lib/site";
import { inNativeApp } from "@/lib/app-shell";
import { AppPushCard } from "@/components/app-push-card";
import { SelfEstimateSettingsCard } from "@/components/crm-self-estimate-settings";
import {
  Settings, Building2, FileText, Bell, CreditCard, Blocks, PartyPopper,
  Users, BookOpen, Tag, Loader2, Copy, Trash2, ArrowRight, Landmark, MapPin, UploadCloud, Plus,
  CalendarDays, RefreshCw, Unplug, Ruler, MessageSquare, Lock, DatabaseBackup,
} from "lucide-react";
import {
  CrmPage, CrmPageHeader, StatusPill, EmptyState, ErrorCard, SectionTitle,
} from "@/components/crm-ui";
import { CRM_THEME_COLORS, resolveOrgTheme } from "@shared/theme-colors";
import { CRM_TEXTING_PLANS as TEXTING_PLANS } from "@shared/plan-copy";
import { CrmBillingCard } from "@/components/crm-billing-card";
import { confirmAction } from "@/components/confirm-dialog";
import { AdminSetupNote } from "@/hooks/use-platform-admin";
import { BID_HEADLINE_SUBLINE_MAX, BID_HEADLINE_TITLE_MAX, bidHeadlineFromCustomFields } from "@shared/bid-headline";

/**
 * Org settings — company profile, document defaults, notification switches,
 * payments status, calendar sync. Gated on manageSettings. Integrations
 * (HOVER, API keys, webhooks) moved to /crm/integrations — a pointer card
 * below keeps the old muscle memory working.
 */

// What the system emails the contractor about today, honestly. Client-facing
// sends (the estimate/invoice itself) are never gated by these switches.
const NOTIFICATIONS = [
  { key: "estimateViewed", label: "Estimate viewed", description: "A client opened an estimate for the first time." },
  { key: "estimateApproved", label: "Estimate approved", description: "A client approved and signed an estimate." },
  { key: "estimateDeclined", label: "Estimate declined", description: "A client declined an estimate." },
  { key: "invoicePaid", label: "Payment received", description: "An online payment landed in your Stripe account." },
  { key: "paymentReceived", label: "Manual payment recorded", description: "A cash, check, wire or card payment was recorded on an invoice." },
  { key: "clientReengaged", label: "Client re-engaged", description: "A client re-opened an estimate — you get an email and a text to call them." },
  { key: "estimateSent", label: "Bid sent to client", description: "A team member sent an estimate to a client." },
  { key: "memberLogin", label: "Team member signs in", description: "Someone on your team signed in (at most one email per person per hour)." },
  { key: "memberAccountChange", label: "Team member changes their account", description: "A team member changed their own profile details or password." },
  { key: "leadReceived", label: "Website lead received", description: "A lead came in through your website lead form." },
  { key: "spamReport", label: "Weekly spam report", description: "AI Call Assistant: once a week, the spam calls it stopped for you (only weeks with spam)." },
  { key: "jobApproved", label: "Job approved (PM email)", description: "The project-manager handoff email when a client signs." },
  { key: "clientComments", label: "Client comments", description: "A client sent a message or photo from their portal." },
  { key: "financeClick", label: "Financing interest", description: "A client opened one of your financing links from their client portal." },
  { key: "paymentReceipt", label: "Payment receipts", description: "The receipt email that goes out when a payment is recorded." },
  { key: "hoverReportReady", label: "New HOVER report", description: "A new HOVER measurement report landed in the CRM. Pick the states below." },
] as const;

type NotifKey = (typeof NOTIFICATIONS)[number]["key"];

const emptyToNull = (s: string) => (s.trim() === "" ? null : s.trim());

/**
 * Every org write refreshes BOTH caches: /api/crm/org (this page) and
 * /api/crm/me, whose `org` snapshot seeds Team & Company and the app shell. A
 * stale /api/crm/me let a later Team save carry old footers and prefs back.
 */
const invalidateOrg = () => {
  queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
  queryClient.invalidateQueries({ queryKey: ["/api/crm/me"] });
};

/**
 * A percent box → basis points, or an error to show. Out-of-range input is
 * refused with a message, never silently clamped (150% must not save as 100%).
 */
function pctToBps(raw: string, label: string, max: number, min = 0): { bps: number | null; error?: string } {
  if (raw.trim() === "") return { bps: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { bps: null, error: `${label} must be a number.` };
  if (n < min || n > max) return { bps: null, error: `${label} must be between ${min}% and ${max}%.` };
  return { bps: Math.round(n * 100) };
}

export default function CrmSettingsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: me, isLoading: meLoading } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const allowed = me?.permissions?.manageSettings === true;

  useEffect(() => {
    if (me && !allowed) navigate("/");
  }, [me, allowed, navigate]);

  const { data: org, isLoading: orgLoading, isError: orgError } = useQuery<any>({
    queryKey: ["/api/crm/org"],
    enabled: allowed,
  });
  const { data: payStatus } = useQuery<any>({
    queryKey: ["/api/crm/payments/status"],
    enabled: allowed,
  });
  const { data: leadSources, isError: leadSourcesError } = useQuery<any[]>({
    queryKey: ["/api/crm/lead-sources"],
    enabled: allowed,
  });
  const { data: calFeed } = useQuery<{ url: string }>({
    queryKey: ["/api/crm/calendar/feed-url"],
    enabled: allowed,
  });
  const { data: gcalStatus } = useQuery<any>({
    queryKey: ["/api/crm/calendar/google/status"],
    enabled: allowed,
  });

  // The Google OAuth round-trip lands on /crm/settings?calendar=connected=1
  // (or error=…). Read it once, then drop it from the URL — like the Team
  // page does — so a reload or a later disconnect never re-shows a stale
  // "connected" banner.
  const [calendarParam] = useState(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("calendar"),
  );
  useEffect(() => {
    if (!calendarParam) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("calendar");
    url.searchParams.delete("error");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [calendarParam]);

  // ── Company profile ───────────────────────────────────────────────────────
  const [company, setCompany] = useState<Record<string, string>>({});
  // The logo URL whose preview failed to load — the warning shows only while
  // the field still holds that exact URL.
  const [logoBrokenUrl, setLogoBrokenUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!org) return;
    const s = (v: any) => v ?? "";
    setCompany({
      name: s(org.name), legalEntityName: s(org.legalEntityName),
      email: s(org.email), phone: s(org.phone), website: s(org.website),
      logoUrl: s(org.logoUrl),
      addressLine1: s(org.addressLine1), addressLine2: s(org.addressLine2),
      city: s(org.city), state: s(org.state), postalCode: s(org.postalCode),
      licenseNumber: s(org.licenseNumber), licenseState: s(org.licenseState),
      industry: s(org.industry), description: s(org.description),
    });
  }, [org?.id]);

  const setC = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setCompany((c) => ({ ...c, [k]: e.target.value }));

  const saveCompany = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", "/api/crm/org", {
      name: company.name || undefined,
      legalEntityName: emptyToNull(company.legalEntityName ?? ""),
      email: emptyToNull(company.email ?? ""),
      phone: emptyToNull(company.phone ?? ""),
      website: emptyToNull(company.website ?? ""),
      logoUrl: emptyToNull(company.logoUrl ?? ""),
      addressLine1: emptyToNull(company.addressLine1 ?? ""),
      addressLine2: emptyToNull(company.addressLine2 ?? ""),
      city: emptyToNull(company.city ?? ""),
      state: emptyToNull(company.state ?? ""),
      postalCode: emptyToNull(company.postalCode ?? ""),
      licenseNumber: emptyToNull(company.licenseNumber ?? ""),
      licenseState: emptyToNull(company.licenseState ?? ""),
      industry: emptyToNull(company.industry ?? ""),
      description: emptyToNull(company.description ?? ""),
    })).json(),
    onSuccess: () => {
      invalidateOrg();
      toast({ title: "Company profile saved" });
    },
    onError: (e: any) => toast({ title: "Could not save company profile", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── Company theme — one of 20 preset accents (customFields.themeColor),
  //    saved instantly on click; applies to client-facing documents only. ────
  const saveTheme = useMutation({
    mutationFn: async (id: string) => (await apiRequest("PATCH", "/api/crm/org", { themeColor: id })).json(),
    onSuccess: () => {
      invalidateOrg();
      toast({ title: "Theme saved" });
    },
    onError: (e: any) => toast({ title: "Could not save theme", description: apiErrorMessage(e), variant: "destructive" }),
  });
  // Which number this company's texts come FROM.
  const [senderForm, setSenderForm] = useState<{
    mode: "platform" | "dedicated"; fromNumber: string;
  }>({ mode: "platform", fromNumber: "" });
  useEffect(() => {
    const sms = (org?.customFields as any)?.sms;
    setSenderForm({
      mode: sms?.mode === "dedicated" ? "dedicated" : "platform",
      fromNumber: sms?.fromNumber ?? "",
    });
  }, [org?.customFields]);

  const saveSender = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/crm/sms/sender", {
      mode: senderForm.mode,
      fromNumber: senderForm.fromNumber.trim() || null,
    })).json(),
    onSuccess: () => {
      invalidateOrg();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sms/status"] });
      toast({ title: "Text sender saved" });
    },
    onError: (e: any) => toast({ title: "Could not save the sender", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // Default for "also text the estimate" when sending a bid.
  const saveSmsEstimates = useMutation({
    mutationFn: async (on: boolean) => (await apiRequest("PATCH", "/api/crm/org", { smsEstimates: on })).json(),
    onSuccess: () => {
      invalidateOrg();
      toast({ title: "Estimate texting saved" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // Org-default bid discounts — the standard offers every sent estimate
  // starts with (the per-estimate Discounts dialog can still adjust one bid).
  const DISCOUNT_PRESETS = [
    { code: "marketing", label: "Marketing discount", percentBps: 100, conditions: "Yard signage during the job + 1 month after, and an honest review." },
    { code: "military", label: "Military discount", percentBps: 200, conditions: "Military ID required." },
    { code: "pay_in_full", label: "Pay-in-full discount", percentBps: 500, conditions: "Paid in full immediately." },
    { code: "bundle", label: "Bundle discount", percentBps: 500, conditions: "Bundle two or more of siding, windows and roofing on one job. Painting, gutters and doors don't count as a scope." },
  ];
  const [discForm, setDiscForm] = useState<{ code: string; label: string; percentBps: number; conditions: string | null; enabled: boolean; rule?: unknown }[]>([]);
  const [discCustom, setDiscCustom] = useState({ label: "", pct: "", conditions: "" });
  // Shown inline under the offer row: 150% is refused, never saved as −100%.
  const discPctError = pctToBps(discCustom.pct, "A discount", 100).error ?? null;
  useEffect(() => {
    const saved = (org?.customFields as any)?.discountDefaults;
    if (Array.isArray(saved) && saved.length) {
      setDiscForm(saved.map((o: any) => ({ code: o.code, label: o.label, percentBps: o.percentBps, conditions: o.conditions ?? null, enabled: o.enabled !== false, rule: o.rule ?? null })));
    } else {
      setDiscForm(DISCOUNT_PRESETS.map((p) => ({ ...p, enabled: false })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.customFields]);
  const saveDiscounts = useMutation({
    mutationFn: async (next: typeof discForm) =>
      (await apiRequest("PATCH", "/api/crm/org", { discountDefaults: next })).json(),
    onSuccess: () => {
      invalidateOrg();
      toast({ title: "Bid discounts saved", description: "New estimates start with these offers when sent." });
    },
    onError: (e: any) => toast({ title: "Could not save discounts", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // Owner text alerts on signed approvals + payments (opt-in, costs money).
  const saveSmsAlerts = useMutation({
    mutationFn: async (on: boolean) => (await apiRequest("PATCH", "/api/crm/org", { smsAlerts: on })).json(),
    onSuccess: () => {
      invalidateOrg();
      toast({ title: "Text alerts saved" });
    },
    onError: (e: any) => toast({ title: "Could not save text alerts", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // Voice "check your email" nudge on estimate send — calls need no carrier
  // campaign, so this works on any sender, including the shared number.
  const saveVoiceNudge = useMutation({
    mutationFn: async (on: boolean) => (await apiRequest("PATCH", "/api/crm/org", { voiceNudge: on })).json(),
    onSuccess: () => {
      invalidateOrg();
      toast({ title: "Voice nudge saved" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // Confetti when a job is closed out (the PM's reward) — on unless the company turns it off.
  const saveCelebrations = useMutation({
    mutationFn: async (on: boolean) => (await apiRequest("PATCH", "/api/crm/org", { celebrations: on })).json(),
    onSuccess: () => {
      invalidateOrg();
      toast({ title: "Celebrations saved" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // Explicit SMS consent (carrier-required): the timestamp lands on MY member
  // record. Enabling any Text channel also stamps it server-side.
  const saveSmsConsent = useMutation({
    mutationFn: async (agree: boolean) => (await apiRequest("POST", "/api/crm/me/sms-consent", { agree })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/me"] });
      toast({ title: "Text consent saved" });
    },
    onError: (e: any) => toast({ title: "Could not save consent", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // The main (band) colour the accent pairs with — black or white.
  const saveThemeBase = useMutation({
    mutationFn: async (base: "black" | "white") =>
      (await apiRequest("PATCH", "/api/crm/org", { themeBase: base })).json(),
    onSuccess: () => {
      invalidateOrg();
      toast({ title: "Theme saved" });
    },
    onError: (e: any) => toast({ title: "Could not save theme", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── Company logo upload (PNG/JPG ≤ 2MB → org.logoUrl, shown on documents) ──
  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 2 * 1024 * 1024) throw new Error("Logo is too large — 2MB maximum.");
      const fd = new FormData();
      fd.append("logo", file);
      const r = await fetch("/api/crm/org/logo", { method: "POST", body: fd, credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Upload failed");
      return j;
    },
    onSuccess: (j: any) => {
      setCompany((c) => ({ ...c, logoUrl: j.logoUrl }));
      invalidateOrg();
      toast({ title: "Logo uploaded" });
    },
    onError: (e: any) => toast({ title: "Could not upload logo", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── Estimate & invoice defaults ───────────────────────────────────────────
  const [defaults, setDefaults] = useState({
    estimateFooter: "", invoiceFooter: "", termsAndConditions: "",
    warrantyText: "", depositPct: "", taxPct: "",
    headlineTitle: "", headlineSubline: "",
  });
  useEffect(() => {
    if (!org) return;
    setDefaults({
      estimateFooter: org.estimateFooter ?? "",
      invoiceFooter: org.invoiceFooter ?? "",
      termsAndConditions: org.termsAndConditions ?? "",
      warrantyText: org.warrantyText ?? "",
      headlineTitle: bidHeadlineFromCustomFields(org.customFields)?.title ?? "",
      headlineSubline: bidHeadlineFromCustomFields(org.customFields)?.subline ?? "",
      depositPct: org.defaultDepositBps ? String(org.defaultDepositBps / 100) : "",
      taxPct: org.defaultTaxRateBps ? String(org.defaultTaxRateBps / 100) : "",
    });
  }, [org?.id]);

  const saveDefaults = useMutation({
    mutationFn: async () => {
      // Refuse out-of-range values before anything is sent (the toast shows
      // why) — a typo like 150% must never quietly save as 100%.
      const deposit = pctToBps(defaults.depositPct, "Default deposit", 100);
      if (deposit.error) throw new Error(deposit.error);
      const tax = pctToBps(defaults.taxPct, "Default sales tax", 30);
      if (tax.error) throw new Error(tax.error);
      return (await apiRequest("PATCH", "/api/crm/org", {
        estimateFooter: emptyToNull(defaults.estimateFooter),
        invoiceFooter: emptyToNull(defaults.invoiceFooter),
        termsAndConditions: emptyToNull(defaults.termsAndConditions),
        warrantyText: emptyToNull(defaults.warrantyText),
        // A blank title takes the headline off every estimate.
        bidHeadline: defaults.headlineTitle.trim()
          ? { title: defaults.headlineTitle, subline: emptyToNull(defaults.headlineSubline) }
          : null,
        defaultDepositBps: deposit.bps,
        defaultTaxRateBps: tax.bps,
      })).json();
    },
    onSuccess: () => {
      invalidateOrg();
      toast({ title: "Defaults saved" });
    },
    onError: (e: any) => toast({ title: "Could not save defaults", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── Notifications ─────────────────────────────────────────────────────────
  // A pref is a legacy boolean (governs in-app + email) or a per-channel
  // object {inApp, email, sms}. Mirrors crmNotificationChannel on the server.
  const notifPrefs: Record<string, boolean | Record<string, boolean>> =
    (org?.customFields as any)?.notificationPrefs ?? {};
  const chanOn = (k: NotifKey, ch: "inApp" | "email" | "sms"): boolean => {
    const v = notifPrefs[k];
    if (v === undefined || v === null) return ch !== "sms";
    if (typeof v === "boolean") return ch === "sms" ? false : v;
    const o = v as Record<string, boolean>;
    return o[ch] === undefined ? ch !== "sms" : o[ch] === true;
  };

  const saveNotif = useMutation({
    mutationFn: async (patch: Record<string, boolean | Record<string, boolean>>) =>
      (await apiRequest("PATCH", "/api/crm/org", { notificationPrefs: patch })).json(),
    onSuccess: () => {
      // invalidateOrg also refreshes /api/crm/me: switching a Text channel on
      // stamps my SMS consent server-side, and the consent checkbox below
      // reads it from me.member.
      invalidateOrg();
      toast({ title: "Notification preferences saved" });
    },
    onError: (e: any) => toast({ title: "Could not save notifications", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── SMS (SignalWire) ──────────────────────────────────────────────────────
  // Honest configuration state: the server names the missing env vars; the
  // test-text control only lights up when texting can actually work.
  const canIntegrations = me?.permissions?.manageIntegrations === true;
  const { data: smsStatus, isPending: smsStatusPending } = useQuery<any>({
    queryKey: ["/api/crm/sms/status"],
    enabled: allowed,
  });
  const [smsTestTo, setSmsTestTo] = useState("");
  const smsTest = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/crm/sms/test", { to: smsTestTo.trim() })).json(),
    onSuccess: (r: any) =>
      toast({ title: "Test text sent", description: `Delivered via ${r.provider} to ${r.to}.` }),
    onError: (e: any) => toast({ title: "Test text failed", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // Deep links such as /crm/settings#sms (the Quick message hint) land on
  // that card. The page renders behind a spinner until the org loads, so the
  // browser's own hash jump finds nothing — scroll once the settings (and the
  // SMS status that sizes the card) are on screen. Once only: never yank a
  // user who has already scrolled away. "Settled", not "has data": a failed
  // status call still renders the card, and must not block the jump.
  const hashScrolled = useRef(false);
  const settingsRendered = allowed && !!org && !smsStatusPending;
  useEffect(() => {
    if (!settingsRendered || hashScrolled.current) return;
    let id = "";
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      hashScrolled.current = true;
      const el = document.getElementById(id);
      if (!el) return;
      // Scroll only the app's own scroll pane: scrollIntoView would also
      // scroll the window and push the top bar out of view.
      let pane = el.parentElement;
      while (pane && !(pane.scrollHeight > pane.clientHeight && /(auto|scroll)/.test(getComputedStyle(pane).overflowY))) {
        pane = pane.parentElement;
      }
      if (pane) pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top - 16;
      else el.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [settingsRendered]);

  // ── Price-floor lock (owner only) ─────────────────────────────────────────
  // custom_fields->'priceFloorLock' — reps can price above the floor, never
  // below. The owner is always exempt (they set the prices).
  const isOwner = me?.member?.role === "owner";
  const priceFloorLock: { enabled?: boolean; floorBps?: number } =
    (org?.customFields as any)?.priceFloorLock ?? {};
  const [floorPct, setFloorPct] = useState("");
  useEffect(() => {
    setFloorPct(priceFloorLock.floorBps != null ? String(priceFloorLock.floorBps / 100) : "");
    // Only re-seed the input when the stored value changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceFloorLock.floorBps]);

  const saveLock = useMutation({
    mutationFn: async ({ enabled }: { enabled: boolean }) => {
      const floor = pctToBps(floorPct, "Floor margin", 100);
      if (floor.error) throw new Error(floor.error);
      return (await apiRequest("PUT", "/api/crm/org/price-floor-lock", { enabled, floorBps: floor.bps })).json();
    },
    onSuccess: () => {
      invalidateOrg();
      toast({ title: "Price lock saved" });
    },
    onError: (e: any) => toast({ title: "Could not save the price lock", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── Auto-backup (owner only) ──────────────────────────────────────────────
  // custom_fields->'backup' — the server merges on save, so lastSentAt and
  // lastError come back on the org and render read-only below.
  const backupCfg: { lastSentAt?: string | null; lastError?: string | null } =
    (org?.customFields as any)?.backup ?? {};
  const [backupForm, setBackupForm] = useState({
    enabled: false,
    frequency: "weekly" as "weekly" | "biweekly" | "custom",
    customDays: "",
    format: "csv" as "csv" | "xlsx",
    email: "",
  });
  useEffect(() => {
    if (!org) return;
    const b = (org.customFields as any)?.backup ?? {};
    setBackupForm({
      enabled: b.enabled === true,
      frequency: b.frequency === "biweekly" || b.frequency === "custom" ? b.frequency : "weekly",
      customDays: b.customDays ? String(b.customDays) : "",
      format: b.format === "xlsx" ? "xlsx" : "csv",
      // Only the saved address — blank means "the default recipient" below.
      email: typeof b.email === "string" ? b.email : "",
    });
    // Only re-seed the form when the org itself changes, not on every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);
  // Where a blank "Send to" delivers (org email, else the owner's seat) —
  // resolved by the server exactly as a send resolves it. Keyed on the
  // company email (editable above), which feeds that default.
  const { data: backupSettings } = useQuery<{ defaultEmail: string | null }>({
    queryKey: ["/api/crm/backups/settings", org?.email ?? null],
    queryFn: async () => (await apiRequest("GET", "/api/crm/backups/settings")).json(),
    enabled: isOwner && !!org,
  });
  const backupDefaultEmail = backupSettings?.defaultEmail ?? null;
  const backupEmailMissing = !backupForm.email.trim() && !backupDefaultEmail;

  const saveBackup = useMutation({
    mutationFn: async () =>
      (await apiRequest("PUT", "/api/crm/backups/settings", {
        enabled: backupForm.enabled,
        frequency: backupForm.frequency,
        customDays: backupForm.frequency === "custom" ? (parseInt(backupForm.customDays) || null) : null,
        format: backupForm.format,
        email: backupForm.email.trim(),
      })).json(),
    onSuccess: () => {
      invalidateOrg();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/backups/settings"] });
      toast({ title: "Export settings saved" });
    },
    onError: (e: any) => toast({ title: "Could not save export settings", description: apiIssueMessage(e, { email: "Send to" }), variant: "destructive" }),
  });

  const sendBackupNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/backups/send-now", {})).json(),
    onSuccess: (r: any) => {
      invalidateOrg();
      toast({
        title: "Export sent",
        description: `${r.rows.clients} clients, ${r.rows.estimates} estimates, ${r.rows.invoices} invoices · ${(r.bytes / 1024).toFixed(1)} KB to ${r.recipient}`,
      });
    },
    onError: (e: any) => toast({ title: "Export failed", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // ── Payments: card fee passthrough + financing links ──────────────────────
  const { data: paySettings, isError: paySettingsError } = useQuery<any>({
    queryKey: ["/api/crm/payments/settings"],
    enabled: allowed,
  });
  const [feeForm, setFeeForm] = useState({
    passFeeToClient: false, surchargePct: "",
    railMode: "both" as "both" | "ach_only" | "card_only", achOnlyOver: "",
  });
  const [finLinks, setFinLinks] = useState<{ label: string; url: string; primary?: boolean }[]>([]);
  const [newLink, setNewLink] = useState({ label: "", url: "" });
  // Reconciliation prompts + receipts (shared/payment-settings.ts), seeded from the same settings call.
  const [recForm, setRecForm] = useState({
    enabled: true, approvalDays: "1, 3, 5", closeoutDays: "1, 3, 5",
    photo: "optional" as "off" | "optional" | "required", notify: "pm_sales" as "pm" | "pm_sales" | "owners",
    email: true, sms: false,
  });
  const [rcptForm, setRcptForm] = useState({ email: true, sms: false });
  const [offlineText, setOfflineText] = useState("");
  useEffect(() => {
    if (!paySettings) return;
    setOfflineText(paySettings.offlineInstructions ?? "");
    setFeeForm({
      passFeeToClient: paySettings.payments?.passFeeToClient === true,
      surchargePct: paySettings.payments?.surchargeBps ? String(paySettings.payments.surchargeBps / 100) : "",
      railMode: paySettings.payments?.railMode === "ach_only" || paySettings.payments?.railMode === "card_only"
        ? paySettings.payments.railMode : "both",
      achOnlyOver: paySettings.payments?.achOnlyOverCents ? String(paySettings.payments.achOnlyOverCents / 100) : "",
    });
    setFinLinks(paySettings.financingLinks ?? []);
    if (paySettings.reconcile) {
      const r = paySettings.reconcile;
      setRecForm({
        enabled: r.enabled !== false,
        approvalDays: (r.approvalDays ?? [1, 3, 5]).join(", "),
        closeoutDays: (r.closeoutDays ?? [1, 3, 5]).join(", "),
        photo: r.photo ?? "optional", notify: r.notify ?? "pm_sales",
        email: r.channels?.email !== false, sms: r.channels?.sms === true,
      });
    }
    if (paySettings.receipts) setRcptForm({ email: paySettings.receipts.email !== false, sms: paySettings.receipts.sms === true });
  }, [paySettings]);

  const savePaySettings = useMutation({
    mutationFn: async (body: any) => (await apiRequest("PUT", "/api/crm/payments/settings", body)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/payments/settings"] });
      invalidateOrg();
      toast({ title: "Payment settings saved" });
    },
    onError: (e: any) => toast({ title: "Could not save payment settings", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const saveFee = () => {
    const surcharge = pctToBps(feeForm.surchargePct, "Card surcharge", 10);
    // Only a surcharge that will actually be charged has to be valid; with
    // the passthrough off an unusable leftover value is simply dropped.
    if (surcharge.error && feeForm.passFeeToClient) {
      toast({ title: "Could not save payment settings", description: surcharge.error, variant: "destructive" });
      return;
    }
    const over = parseFloat(feeForm.achOnlyOver);
    savePaySettings.mutate({
      payments: {
        passFeeToClient: feeForm.passFeeToClient,
        surchargeBps: surcharge.bps,
        railMode: feeForm.railMode,
        achOnlyOverCents: feeForm.railMode !== "both" || feeForm.achOnlyOver.trim() === "" || Number.isNaN(over) || over <= 0
          ? null
          : Math.round(Math.min(1_000_000, over) * 100),
      },
    });
  };

  const saveLinks = (links: typeof finLinks) => {
    setFinLinks(links);
    savePaySettings.mutate({ financingLinks: links });
  };

  // ── Calendar sync ─────────────────────────────────────────────────────────
  const rotateFeed = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/calendar/rotate-feed-token", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/calendar/feed-url"] });
      toast({ title: "New feed URL generated", description: "Old calendar subscriptions will stop updating." });
    },
    onError: (e: any) => toast({ title: "Could not regenerate", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const googleConnect = useMutation({
    mutationFn: async () => (await apiRequest("GET", "/api/crm/calendar/google/connect", undefined)).json(),
    onSuccess: (r: any) => { if (r.url) window.location.href = r.url; },
    onError: (e: any) => toast({ title: "Can't start Google connect", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const googleSync = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/calendar/google/sync", {})).json(),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/calendar/google/status"] });
      toast({ title: "Synced to Google Calendar", description: `${r.total ?? 0} appointments pushed (${r.upserted ?? 0} written, ${r.deleted ?? 0} removed).` });
    },
    onError: (e: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/calendar/google/status"] });
      toast({ title: "Sync failed", description: apiErrorMessage(e), variant: "destructive" });
    },
  });

  const googleDisconnect = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/calendar/google/disconnect", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/calendar/google/status"] });
      toast({ title: "Google Calendar disconnected" });
    },
    onError: (e: any) => toast({ title: "Could not disconnect", description: apiErrorMessage(e), variant: "destructive" }),
  });

  if (meLoading || (allowed && orgLoading)) {
    return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!allowed) return null; // redirect effect above fires; nothing to render
  if (orgError || !org) {
    return <ErrorCard title="Couldn't load settings" description="Check your connection and refresh the page." />;
  }

  const acct = payStatus?.account;
  const theme = resolveOrgTheme(org?.customFields);
  const gcal = gcalStatus?.connection ?? null;

  return (
    <CrmPage className="max-w-4xl">
      <CrmPageHeader
        icon={Settings}
        title="Settings"
        infoKey="settings"
        /* Explicit: the route lookup picks the first /crm/settings entry alphabetically (the brand-colour
           walkthrough), which is not this page's own. crm-settings has no recording yet, so nothing shows. */
        help={<HelpButton k="crm-settings" videoOnly />}
        subtitle="Company profile, document defaults, notifications and calendar."
      />

      {/* ── Company profile ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <SectionTitle
            icon={Building2}
            title="Company profile"
            infoKey="settings-company"
            description="Appears on estimates, invoices and the client portal."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="company-name">Company name</Label>
              <Input id="company-name" data-testid="input-company-name"
                value={company.name ?? ""} onChange={setC("name")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-legal">Legal entity</Label>
              <Input id="company-legal" data-testid="input-company-legal" placeholder="e.g. Alpine Exteriors LLC"
                value={company.legalEntityName ?? ""} onChange={setC("legalEntityName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-email">Email</Label>
              <Input id="company-email" type="email" data-testid="input-company-email"
                value={company.email ?? ""} onChange={setC("email")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-phone">Phone</Label>
              <Input id="company-phone" data-testid="input-company-phone"
                value={company.phone ?? ""} onChange={setC("phone")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-website">Website</Label>
              <Input id="company-website" data-testid="input-company-website" placeholder="https://…"
                value={company.website ?? ""} onChange={setC("website")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-logo">Logo URL</Label>
              <Input id="company-logo" data-testid="input-company-logo" placeholder="https://…"
                value={company.logoUrl ?? ""} onChange={setC("logoUrl")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-logo-file">Upload logo</Label>
              <div className="flex items-center gap-3">
                {company.logoUrl && logoBrokenUrl !== company.logoUrl && (
                  <img src={company.logoUrl} alt="Company logo" data-testid="img-company-logo"
                    onError={() => setLogoBrokenUrl(company.logoUrl)}
                    className="h-9 w-9 rounded border object-contain bg-white" />
                )}
                <Input id="company-logo-file" type="file" accept="image/png,image/jpeg"
                  data-testid="input-company-logo-file" disabled={uploadLogo.isPending}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadLogo.mutate(f);
                    e.target.value = "";
                  }} />
              </div>
              <p className="text-xs text-muted-foreground">
                PNG or JPG, 2MB max. Shows on estimates, invoices and the portal.
                {uploadLogo.isPending ? " Uploading…" : ""}
              </p>
              {company.logoUrl && logoBrokenUrl === company.logoUrl && (
                <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-company-logo-broken">
                  Couldn't load an image from this logo URL — check the address, or upload the file instead.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-address1">Address</Label>
              <Input id="company-address1" data-testid="input-company-address1"
                value={company.addressLine1 ?? ""} onChange={setC("addressLine1")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-address2">Address line 2</Label>
              <Input id="company-address2" data-testid="input-company-address2"
                value={company.addressLine2 ?? ""} onChange={setC("addressLine2")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-city">City</Label>
              <Input id="company-city" data-testid="input-company-city"
                value={company.city ?? ""} onChange={setC("city")} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="company-state">State</Label>
                <Input id="company-state" data-testid="input-company-state"
                  value={company.state ?? ""} onChange={setC("state")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company-postal">ZIP</Label>
                <Input id="company-postal" data-testid="input-company-postal"
                  value={company.postalCode ?? ""} onChange={setC("postalCode")} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-license-number">License #</Label>
              <Input id="company-license-number" data-testid="input-company-license-number"
                value={company.licenseNumber ?? ""} onChange={setC("licenseNumber")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-license-state">License state</Label>
              <Input id="company-license-state" data-testid="input-company-license-state" placeholder="e.g. FL"
                value={company.licenseState ?? ""} onChange={setC("licenseState")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="company-industry">Industry</Label>
              <Input id="company-industry" data-testid="input-company-industry"
                value={company.industry ?? ""} onChange={setC("industry")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="company-description">Description</Label>
              <Textarea id="company-description" rows={3} data-testid="textarea-company-description"
                value={company.description ?? ""} onChange={setC("description")} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => saveCompany.mutate()} disabled={saveCompany.isPending || !company.name?.trim()}
              data-testid="button-save-company">
              {saveCompany.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save company profile
            </Button>
          </div>

          {/* ── Company theme ── one accent from 20 presets, always paired
              with black; colours the estimates, invoices, contracts and the
              client portal — never the CRM workspace itself. Saves on click. */}
          <div className="border-t pt-4 space-y-3" data-testid="section-company-theme">
            <div>
              <div className="text-sm font-medium flex items-center gap-1">Company theme<InfoTip k="settings-theme" /></div>
              <p className="text-xs text-muted-foreground">
                The accent on your estimates, invoices, contracts and client portal — paired with a black or white base, your choice.
              </p>
            </div>
            {/* Base: the main band colour the accent sits on. */}
            <div className="flex items-center gap-2" data-testid="theme-base-picker">
              <span className="text-xs text-muted-foreground mr-1">Main color</span>
              {(["black", "white"] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  aria-pressed={theme.base === b}
                  disabled={saveThemeBase.isPending}
                  onClick={() => saveThemeBase.mutate(b)}
                  data-testid={`theme-base-${b}`}
                  className={`h-8 px-3.5 rounded-md border text-xs font-medium capitalize transition-shadow disabled:opacity-60 ${
                    b === "black" ? "bg-[#111827] text-white" : "bg-white text-[#111827]"
                  } ${theme.base === b
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : "hover:ring-1 hover:ring-foreground/40"}`}
                >
                  {b}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-2" data-testid="theme-swatch-grid">
              {CRM_THEME_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.name}
                  aria-label={`Theme ${c.name}`}
                  aria-pressed={theme.id === c.id}
                  disabled={saveTheme.isPending}
                  onClick={() => saveTheme.mutate(c.id)}
                  data-testid={`theme-swatch-${c.id}`}
                  className={`h-9 rounded-md border overflow-hidden transition-shadow disabled:opacity-60 ${
                    theme.id === c.id
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : "hover:ring-1 hover:ring-foreground/40"
                  }`}
                  style={{ background: `linear-gradient(to bottom, ${theme.baseHex} 50%, ${c.hex} 50%)` }}
                />
              ))}
            </div>
            {/* Live preview — a miniature document header in the chosen base +
                the current accent. */}
            <div className="rounded-lg border overflow-hidden" data-testid="theme-preview-strip">
              <div className={`px-4 py-2.5 flex items-center justify-between gap-3 ${theme.base === "white" ? "border-b" : ""}`}
                style={{ backgroundColor: theme.baseHex }}>
                <span className="text-sm font-semibold truncate" style={{ color: theme.hex }} data-testid="theme-preview-name">
                  {company.name || org.name}
                </span>
                <span className="text-[10px] uppercase tracking-widest shrink-0"
                  style={{ color: theme.base === "white" ? "#6B7280" : "#9CA3AF" }}>Estimate</span>
              </div>
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">This is how your documents look</span>
                <span
                  className="rounded-md px-3 py-1.5 text-xs font-medium shrink-0"
                  style={{ backgroundColor: theme.hex, color: theme.onHex }}
                  data-testid="theme-preview-button"
                >
                  Approve estimate
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* The CRM's own subscription and the account's invoices (receipts are emailed per payment). */}

      <CrmBillingCard />


      {/* ── Divisions (shared with Team & Company → Divisions) ── */}
      <CrmDivisionsManager />

      {/* ── Estimate & invoice defaults ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <SectionTitle
            icon={FileText}
            title="Estimate & invoice defaults"
            infoKey="settings-defaults"
            description="Pre-filled on every new document; editable per document."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="estimate-footer">Estimate footer</Label>
              <Textarea id="estimate-footer" rows={3} data-testid="textarea-estimate-footer"
                value={defaults.estimateFooter}
                onChange={(e) => setDefaults((d) => ({ ...d, estimateFooter: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-footer">Invoice footer</Label>
              <Textarea id="invoice-footer" rows={3} data-testid="textarea-invoice-footer"
                value={defaults.invoiceFooter}
                onChange={(e) => setDefaults((d) => ({ ...d, invoiceFooter: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="terms">Terms &amp; conditions</Label>
              <Textarea id="terms" rows={3} data-testid="textarea-terms"
                value={defaults.termsAndConditions}
                onChange={(e) => setDefaults((d) => ({ ...d, termsAndConditions: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warranty">Warranty text</Label>
              <Textarea id="warranty" rows={3} data-testid="textarea-warranty"
                value={defaults.warrantyText}
                onChange={(e) => setDefaults((d) => ({ ...d, warrantyText: e.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2 rounded-lg border p-3" data-testid="bid-headline-settings">
              <Label htmlFor="bid-headline">Bid headline</Label>
              <Input id="bid-headline" data-testid="input-bid-headline" maxLength={BID_HEADLINE_TITLE_MAX}
                placeholder="e.g. Every job backed by our 10-year workmanship warranty"
                value={defaults.headlineTitle}
                onChange={(e) => setDefaults((d) => ({ ...d, headlineTitle: e.target.value }))} />
              <Label htmlFor="bid-headline-subline" className="text-xs text-muted-foreground">Smaller line under it</Label>
              <Textarea id="bid-headline-subline" rows={2} data-testid="textarea-bid-headline-subline"
                maxLength={BID_HEADLINE_SUBLINE_MAX}
                placeholder="The conditions and limits of the claim, e.g. what is covered and for how long."
                value={defaults.headlineSubline}
                onChange={(e) => setDefaults((d) => ({ ...d, headlineSubline: e.target.value }))} />
              <p className="text-xs text-muted-foreground">
                A banner at the very top of each estimate you create after saving — on the client's page, the
                estimate email and the signed contract — above the scopes and line items, with a link to the
                estimate's warranty text. Estimates already created keep what they had. If the claim has conditions
                or limits, state them on the smaller line. Leave the headline blank to show none.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="default-deposit">Default deposit (%)</Label>
              <Input id="default-deposit" type="number" min={0} max={100} step="0.5"
                data-testid="input-default-deposit" placeholder="e.g. 10"
                value={defaults.depositPct}
                onChange={(e) => setDefaults((d) => ({ ...d, depositPct: e.target.value }))} />
              <p className="text-xs text-muted-foreground">
                Note: some states cap contractor deposits (CA, NV, MD, MA, PA, NY).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="default-tax">Default sales tax (%)</Label>
              <Input id="default-tax" type="number" min={0} max={30} step="0.1"
                data-testid="input-default-tax" placeholder="e.g. 8.8"
                value={defaults.taxPct}
                onChange={(e) => setDefaults((d) => ({ ...d, taxPct: e.target.value }))} />
              <p className="text-xs text-muted-foreground">
                Fallback when no city or division rate matches — rates are managed in
                Settings → Divisions — verify with your accountant.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => saveDefaults.mutate()} disabled={saveDefaults.isPending}
              data-testid="button-save-defaults">
              {saveDefaults.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save defaults
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Notifications ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <SectionTitle
            icon={Bell}
            title="Notifications"
            infoKey="settings-notifications"
            description="Emails the system sends to you. Emails to your clients (the estimate or invoice itself) always send."
          />
        </CardHeader>
        <CardContent>
          <div className="mb-4 empty:hidden"><AppPushCard /></div>
          {/* Sticky so the channel names stay on screen while scrolling the
              14 rows — on a phone the header otherwise scrolls away and
              leaves three unlabeled switches per row. */}
          <div className="sticky top-0 z-10 bg-card grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 text-xs text-muted-foreground pt-2 pb-2 border-b"
            data-testid="notif-channel-header">
            <span />
            <span className="w-10 text-center">In-app</span>
            <span className="w-10 text-center">Email</span>
            <span className="w-10 text-center">Text</span>
          </div>
          <div className="divide-y">
            {NOTIFICATIONS.map((n) => (
              <div key={n.key} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 py-3 last:pb-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{n.label}</div>
                  <div className="text-xs text-muted-foreground">{n.description}</div>
                </div>
                {(["inApp", "email", "sms"] as const).map((ch) => (
                  <div key={ch} className="w-10 flex justify-center">
                    <Switch
                      checked={chanOn(n.key, ch)}
                      onCheckedChange={(v) =>
                        saveNotif.mutate({
                          [n.key]: {
                            inApp: ch === "inApp" ? v : chanOn(n.key, "inApp"),
                            email: ch === "email" ? v : chanOn(n.key, "email"),
                            sms: ch === "sms" ? v : chanOn(n.key, "sms"),
                          },
                        })
                      }
                      disabled={saveNotif.isPending}
                      aria-label={`${n.label}: ${ch === "inApp" ? "in-app" : ch === "email" ? "email" : "text"}`}
                      data-testid={ch === "email" ? `switch-notif-${n.key}` : `switch-notif-${n.key}-${ch}`}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <HoverNotifyStates org={org} />
          <p className="text-xs text-muted-foreground pt-3">
            Text alerts also need a text sender set up in the SMS card below.
          </p>
          <div className="flex items-start gap-2 border-t mt-3 pt-3" data-testid="section-sms-consent">
            <Checkbox
              id="sms-consent"
              checked={!!me?.member?.smsConsentAt}
              onCheckedChange={(v) => saveSmsConsent.mutate(v === true)}
              disabled={saveSmsConsent.isPending}
              data-testid="checkbox-sms-consent"
            />
            <label htmlFor="sms-consent" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
              I agree to receive account-notification texts from ConstructHUB at the phone number on my profile.
              Message frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.
              We do not share or sell your SMS consent or phone number.
              See the <a href="/crm-privacy" className="text-primary hover:underline">Privacy Policy</a>.
              {me?.member?.smsConsentAt && (
                <span className="block mt-1" data-testid="text-sms-consent-stamp">
                  Consented {new Date(me.member.smsConsentAt).toLocaleString()}
                  {me.member.smsConsentPhone ? ` — ${me.member.smsConsentPhone}` : ""}.
                </span>
              )}
            </label>
          </div>
        </CardContent>
      </Card>

      {/* ── Bid discounts (org defaults) ────────────────────────────────── */}
      {/* Client page — container order and which show (owner/admin). */}
      <ClientPageLayoutCard />

      {/* Job flow — the phases on the client page's tracker and the alerts each one sends (owner/admin). */}
      <JobFlowCard />

      {/* Celebrations — confetti when a job is closed out. */}
      <Card data-testid="card-celebrations">
        <CardHeader>
          <SectionTitle icon={PartyPopper} title="Celebrations"
            description={'A little reward for the PM: when a job is closed out — by hand or by the last walkthrough — confetti sprays the screen with "Congrats, a job has been closed out!"'} />
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium">Confetti on close-out</div>
              <p className="text-xs text-muted-foreground">On for the whole company. Turn it off here if it's not your style.</p>
            </div>
            <Switch
              checked={(org?.customFields as any)?.celebrations !== false}
              onCheckedChange={(v) => saveCelebrations.mutate(v)}
              disabled={saveCelebrations.isPending}
              aria-label="Confetti on close-out" data-testid="switch-celebrations"
            />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-bid-discounts">
        <CardHeader>
          <SectionTitle
            icon={Tag}
            title="Bid discounts"
            description="The offers every sent estimate starts with. Clients tick what they qualify for on the bid, and the total updates — the Discounts button on any single estimate can still adjust that one."
          />
        </CardHeader>
        <CardContent className="space-y-3">
          {discForm.map((o, idx) => (
            <div key={o.code} className="flex items-start justify-between gap-3 rounded-lg border p-3"
              data-testid={`default-discount-${o.code}`}>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {o.label}{" "}
                  <span className="text-primary">
                    {(() => {
                      const rule = bundleRuleOf(o.rule) ?? orgDiscountRule(org?.customFields, o.code);
                      return rule ? bundleRuleText(rule) : `−${(o.percentBps / 100).toLocaleString("en-US")}%`;
                    })()}
                  </span>
                </div>
                {o.conditions && <div className="text-xs text-muted-foreground mt-0.5">{o.conditions}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={o.enabled}
                  onCheckedChange={(v) => {
                    const next = discForm.map((x, i) => (i === idx ? { ...x, enabled: v === true } : x));
                    setDiscForm(next); saveDiscounts.mutate(next);
                  }}
                  aria-label={`${o.label} discount`} data-testid={`switch-discount-${o.code}`} />
                {!DISCOUNT_PRESETS.some((p) => p.code === o.code) && (
                  <Button size="sm" variant="ghost" className="text-destructive"
                    onClick={() => { const next = discForm.filter((_, i) => i !== idx); setDiscForm(next); saveDiscounts.mutate(next); }}
                    aria-label={`Remove ${o.label} discount`} data-testid={`button-remove-discount-${o.code}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <div className="space-y-1.5 flex-1 min-w-40">
              <Label htmlFor="disc-label">Your own offer</Label>
              <Input id="disc-label" placeholder="e.g. Referral discount" value={discCustom.label}
                onChange={(e) => setDiscCustom((f) => ({ ...f, label: e.target.value }))}
                data-testid="input-discount-label" />
            </div>
            <div className="space-y-1.5 w-24">
              <Label htmlFor="disc-pct">%</Label>
              <Input id="disc-pct" type="number" min={0} max={100} step="0.5" value={discCustom.pct}
                onChange={(e) => setDiscCustom((f) => ({ ...f, pct: e.target.value }))}
                data-testid="input-discount-pct" />
            </div>
            <div className="space-y-1.5 flex-1 min-w-48">
              <Label htmlFor="disc-cond">Conditions (optional)</Label>
              <Input id="disc-cond" placeholder="What qualifies" value={discCustom.conditions}
                onChange={(e) => setDiscCustom((f) => ({ ...f, conditions: e.target.value }))}
                data-testid="input-discount-conditions" />
            </div>
            <Button size="sm"
              disabled={!discCustom.label.trim() || !(parseFloat(discCustom.pct) > 0) || !!discPctError || saveDiscounts.isPending}
              onClick={() => {
                const pct = pctToBps(discCustom.pct, "A discount", 100);
                if (pct.error || pct.bps === null) return;
                const next = [...discForm, {
                  code: `custom-${Date.now().toString(36)}`,
                  label: discCustom.label.trim(),
                  percentBps: pct.bps,
                  conditions: discCustom.conditions.trim() || null,
                  enabled: true,
                }];
                setDiscForm(next); saveDiscounts.mutate(next);
                setDiscCustom({ label: "", pct: "", conditions: "" });
              }}
              data-testid="button-add-discount">
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
          {discPctError && (
            <p className="text-xs text-destructive" data-testid="text-discount-pct-error">{discPctError}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Client self-estimate (per-division products + prices) ─────── */}
      <SelfEstimateSettingsCard />

      {/* ── SMS (SignalWire) ───────────────────────────────────────────── */}
      <Card data-testid="card-sms" id="sms" className="scroll-mt-4">
        <CardHeader>
          <SectionTitle
            icon={MessageSquare}
            title="SMS"
            infoKey="settings-sms"
            description="Text bid reminders to clients, and get a text when a bid is signed, money lands, or a client re-opens their estimate."
          />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              {smsStatus?.planAllowsSms === false ? (
                inNativeApp() ? (
                  // The iPhone apps sell nothing: no plan names, no "Upgrade", no
                  // link to Pricing (App Store 3.1.3(f); docs/app/APP-STORE-PLAN.md).
                  <>
                    <div className="font-medium" data-testid="text-sms-plan">Texting isn't on this account.</div>
                    <div className="text-xs text-muted-foreground">
                      Text bid reminders to clients, and get a text when a bid is signed, money lands, or a client
                      re-opens their estimate. Emails keep working.
                    </div>
                  </>
                ) : (
                  <>
                  <div className="font-medium" data-testid="text-sms-plan">Texting is included with the {TEXTING_PLANS} plans</div>
                  <div className="text-xs text-muted-foreground">
                    {/* The heading names the plans from the same price book the server's gate reads (server/crm/sms.ts). */}
                    Change your CRM plan in Pricing to turn it on. Texting covers reminders to clients, quick texts, and a text to you when a bid is
                    signed, money lands, or a client re-opens their estimate. Emails keep working on every plan.
                  </div>
                  {/* The portal host has no /pricing route (it would fall
                      through to CRM home) — plans live on the main site. */}
                  <a href={marketingUrl("/pricing")} className="text-xs text-primary underline" data-testid="link-sms-upgrade">See plans</a>
                  </>
                )
              ) : smsStatus?.configured ? (
                <>
                  <div className="font-medium" data-testid="text-sms-configured">
                    Texting from {smsStatus.fromNumber}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Reminder texts and re-engagement alerts send as real SMS.
                  </div>
                  {smsStatus.canTextClients === false && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 mt-1" data-testid="text-sms-client-note">
                      The shared number texts YOUR team only (bids signed, money landed, client re-opens).
                      Texting CLIENTS needs a dedicated number — pick "A number we set up for you" below. That number needs
                      its carrier registration (10DLC); carriers no longer allow a shared number to text
                      on behalf of many businesses.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="font-medium" data-testid="text-sms-not-configured">SMS is not configured</div>
                  <div className="text-xs text-muted-foreground" data-testid="text-sms-missing">
                    Set {(smsStatus?.missing?.length ? smsStatus.missing : ["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "SIGNALWIRE_FROM_NUMBER"]).join(", ")} on
                    the server to enable texting. Until then, texts are recorded to the server log instead of being sent.
                  </div>
                  <div className="text-xs text-muted-foreground mt-1" data-testid="text-sms-gray-note">
                    Quick messages to clients stay email-only while this is off — the Text option is grayed out everywhere until it's enabled here.
                  </div>
                </>
              )}
            </div>
            {smsStatus && (
              <StatusPill tone={smsStatus.configured ? "success" : "neutral"} data-testid="pill-sms-status">
                {smsStatus.planAllowsSms === false
                  ? inNativeApp() ? "Not on this account" : "Upgrade to enable"
                  : smsStatus.configured ? "Configured" : "Not configured"}
              </StatusPill>
            )}
          </div>
          {canIntegrations && smsStatus?.planAllowsSms !== false && (
            <div className="border-t pt-3 space-y-3" data-testid="section-sms-sender">
              <div>
                <div className="text-sm font-medium">Which number your texts come from</div>
                <p className="text-xs text-muted-foreground">
                  Every text names your company either way — this is the number that shows on the client's phone.
                </p>
              </div>
              <Select value={senderForm.mode}
                onValueChange={(v) => setSenderForm((f) => ({ ...f, mode: v as typeof f.mode }))}>
                <SelectTrigger className="w-full sm:w-96" aria-label="Which number your texts come from" data-testid="select-sms-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="platform">Shared ConstructHUB number (nothing to set up)</SelectItem>
                  {/* Buying a ConstructHUB-billed number is a sale — not offered in the iPhone apps
                      (App Store 3.1.3(f)). An account that already has one keeps it, labelled neutrally. */}
                  {!inNativeApp() ? (
                    <SelectItem value="dedicated">A number we set up for you, billed through ConstructHUB</SelectItem>
                  ) : senderForm.mode === "dedicated" ? (
                    <SelectItem value="dedicated">My own number (set up on the website)</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>

              {senderForm.mode !== "platform" && (
                <div className="space-y-1.5">
                  <Label htmlFor="sms-from">Your text number</Label>
                  <Input id="sms-from" className="w-full sm:w-64" placeholder="+1 360 555 0134"
                    value={senderForm.fromNumber}
                    onChange={(e) => setSenderForm((f) => ({ ...f, fromNumber: e.target.value }))}
                    data-testid="input-sms-from" />
                  {senderForm.mode === "dedicated" && !inNativeApp() && (
                    <p className="text-xs text-muted-foreground">
                      Ask us to provision this number for you — it stays on ConstructHUB's carrier account.
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <Button size="sm" onClick={() => saveSender.mutate()} disabled={saveSender.isPending}
                  data-testid="button-save-sms-sender">
                  {saveSender.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save sender
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 border-t pt-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Text estimates to clients</div>
              <p className="text-xs text-muted-foreground">
                When you send a bid, also text the client a link. You can still flip this per send;
                clients without a mobile just get the email.
              </p>
              {smsStatus?.canTextClients === false && (
                <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="note-sms-estimates-number">
                  Clients are texted from a client-texting number — set one up in "Which number your texts come from" above.
                </p>
              )}
            </div>
            <Switch
              checked={(org?.customFields as any)?.smsEstimates === true && smsStatus?.canTextClients !== false}
              onCheckedChange={(v) => saveSmsEstimates.mutate(v)}
              disabled={saveSmsEstimates.isPending || !smsStatus?.configured || smsStatus?.canTextClients === false}
              aria-label="Text estimates to clients" data-testid="switch-sms-estimates"
            />
          </div>

          <div className="flex items-center justify-between gap-4 border-t pt-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Call the client to check their email</div>
              <p className="text-xs text-muted-foreground">
                When you send a bid, also ring the client's phone with a short "your estimate is in your
                inbox (or spam folder)" message. Calls need no carrier registration — this works on any
                sender, including the shared number.
              </p>
            </div>
            <Switch
              checked={(org?.customFields as any)?.voiceNudge === true}
              onCheckedChange={(v) => saveVoiceNudge.mutate(v)}
              disabled={saveVoiceNudge.isPending}
              aria-label="Call the client to check their email" data-testid="switch-voice-nudge"
            />
          </div>

          <div className="flex items-center justify-between gap-4 border-t pt-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Text me when a bid is signed or money lands</div>
              <p className="text-xs text-muted-foreground">
                Sends to the owner's mobile (Team &amp; Company → My profile), or the company phone.
                Off by default — each text costs a fraction of a cent.
              </p>
            </div>
            <Switch
              checked={(org?.customFields as any)?.smsAlerts === true}
              onCheckedChange={(v) => saveSmsAlerts.mutate(v)}
              disabled={saveSmsAlerts.isPending || !smsStatus?.configured}
              aria-label="Text me when a bid is signed or money lands" data-testid="switch-sms-alerts"
            />
          </div>

          {canIntegrations && (
            <div className="flex flex-wrap items-end gap-3 border-t pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="sms-test-to">Send a test text</Label>
                <Input id="sms-test-to" className="w-56" placeholder="+1 555 123 4567"
                  value={smsTestTo} onChange={(e) => setSmsTestTo(e.target.value)}
                  data-testid="input-sms-test-to" />
              </div>
              <Button size="sm" variant="outline"
                onClick={() => smsTest.mutate()}
                disabled={!smsStatus?.configured || !smsTestTo.trim() || smsTest.isPending}
                data-testid="button-sms-test-send">
                {smsTest.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageSquare className="h-4 w-4 mr-2" />}
                Send test text
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      {/* ── Price-floor lock (owner only) ───────────────────────────────── */}
      {isOwner && (
        <Card data-testid="card-price-lock">
          <CardHeader>
            <SectionTitle
              icon={Lock}
              title="Price floor lock"
              infoKey="price-lock"
              description="Reps can price above the floor, never below. You can still edit SKUs, price charts and discounts anytime."
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Lock pricing</div>
                <div className="text-xs text-muted-foreground">
                  The floor is each price-book SKU's current price — or its cost when no SKU matches.
                </div>
              </div>
              <Switch
                checked={priceFloorLock.enabled === true}
                onCheckedChange={(v) => saveLock.mutate({ enabled: v })}
                disabled={saveLock.isPending}
                aria-label="Lock pricing" data-testid="switch-price-lock"
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="price-floor-bps">Floor margin over cost (%)</Label>
                <Input id="price-floor-bps" type="number" min={0} max={100} step="0.5" className="w-40"
                  data-testid="input-price-floor-bps" placeholder="e.g. 30"
                  value={floorPct}
                  onChange={(e) => setFloorPct(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  Optional — floor at cost + this margin instead of the SKU price. Only meaningful where a cost exists.
                </p>
              </div>
              <Button
                onClick={() => saveLock.mutate({ enabled: priceFloorLock.enabled === true })}
                disabled={saveLock.isPending}
                data-testid="button-save-price-floor">
                {saveLock.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save floor
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Auto-backup (owner only) ────────────────────────────────────── */}
      {isOwner && (
        <Card data-testid="card-backup">
          <CardHeader>
            <SectionTitle
              icon={DatabaseBackup}
              title="Scheduled exports"
              description="An export of clients, estimates and invoices, emailed on your schedule. Attachments, signed documents, payments and other CRM records are excluded. Restore is not available."
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Automatic email exports</div>
                <div className="text-xs text-muted-foreground">
                  When an export comes due it's generated and emailed automatically (checked every 15 minutes).
                </div>
              </div>
              <Switch
                checked={backupForm.enabled}
                onCheckedChange={(v) => setBackupForm((f) => ({ ...f, enabled: v }))}
                aria-label="Automatic email exports" data-testid="switch-backup-enabled"
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="backup-frequency">Frequency</Label>
                <Select value={backupForm.frequency}
                  onValueChange={(v) => setBackupForm((f) => ({ ...f, frequency: v as typeof f.frequency }))}>
                  <SelectTrigger id="backup-frequency" className="w-44" data-testid="select-backup-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Every week</SelectItem>
                    <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                    <SelectItem value="custom">Custom…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {backupForm.frequency === "custom" && (
                <div className="space-y-1.5">
                  <Label htmlFor="backup-days">Every N days</Label>
                  <Input id="backup-days" type="number" min={1} max={90} className="w-28"
                    placeholder="e.g. 3" value={backupForm.customDays}
                    onChange={(e) => setBackupForm((f) => ({ ...f, customDays: e.target.value }))}
                    data-testid="input-backup-custom-days" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="backup-format">Format</Label>
                <Select value={backupForm.format}
                  onValueChange={(v) => setBackupForm((f) => ({ ...f, format: v as typeof f.format }))}>
                  <SelectTrigger id="backup-format" className="w-56" data-testid="select-backup-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">CSV (three files)</SelectItem>
                    <SelectItem value="xlsx">Excel (.xls, three sheets)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="backup-email">Send to</Label>
                <Input id="backup-email" type="email" className="w-64"
                  data-testid="input-backup-email" placeholder={backupDefaultEmail ?? "you@company.com"}
                  value={backupForm.email}
                  onChange={(e) => setBackupForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <Button onClick={() => saveBackup.mutate()}
                disabled={saveBackup.isPending || (backupForm.enabled && backupEmailMissing)}
                data-testid="button-save-backup">
                {saveBackup.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save export settings
              </Button>
            </div>
            {backupSettings && (
              <p className={`text-xs ${backupEmailMissing ? "text-destructive" : "text-muted-foreground"}`}
                data-testid="text-backup-email-hint">
                {backupDefaultEmail
                  ? `Leave "Send to" blank to send exports to ${backupDefaultEmail}.`
                  : `Add a "Send to" address — there's no company or owner email to send exports to.`}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button variant="outline" onClick={() => sendBackupNow.mutate()}
                disabled={sendBackupNow.isPending}
                data-testid="button-send-backup-now">
                {sendBackupNow.isPending
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <DatabaseBackup className="h-4 w-4 mr-2" />}
                Send export now
              </Button>
              <div className="text-xs text-muted-foreground" data-testid="text-backup-last-sent">
                {backupCfg.lastSentAt
                  ? `Last sent ${new Date(backupCfg.lastSentAt).toLocaleString()}`
                  : "Never sent yet"}
              </div>
            </div>
            {backupCfg.lastError && (
              <p className="text-xs text-destructive" data-testid="text-backup-error">
                Last export failed: {backupCfg.lastError}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Lead visibility by location (owner, 2026-10-18) ─────────────── */}
      <LeadVisibilityCard />

      {/* ── Payments ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <SectionTitle
            icon={CreditCard}
            title="Payments"
            infoKey="settings-payments"
            description="Your own Stripe account, via Stripe Connect."
            actions={
              <Link href="/crm/payments" data-testid="link-payments"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                Open payments <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3" data-testid="card-payments-status">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Landmark className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {acct ? (acct.businessName || acct.accountEmail || acct.externalAccountId) : "No account connected"}
              </div>
              <div className="text-xs text-muted-foreground">
                {acct
                  ? "Payments go directly to your Stripe account — we never hold your money."
                  : "Connect Stripe on the Payments page to take card and ACH payments."}
              </div>
            </div>
            {payStatus && (
              <StatusPill tone={acct?.chargesEnabled ? "success" : "neutral"} data-testid="pill-payments-status">
                {acct ? (acct.chargesEnabled ? "Connected" : "Connected · charges off") : "Not connected"}
              </StatusPill>
            )}
          </div>

          {/* On a settings load error the fee/rail form would show hardcoded
              defaults — saving those would silently overwrite the real
              settings, so the whole form hides behind an honest error. */}
          {paySettingsError ? (
            <p className="mt-6 border-t pt-4 text-sm text-destructive" data-testid="text-payment-settings-error">
              Couldn't load payment settings — refresh the page before changing them.
            </p>
          ) : (
          <>
          {/* Rail policy — the org decides what clients may pay with. */}
          <div className="mt-6 border-t pt-4 space-y-3" data-testid="section-rail-policy">
            <div>
              <div className="text-sm font-medium">Payment methods you offer</div>
              <p className="text-xs text-muted-foreground">
                You control the rails — clients only see what you allow. ACH costs 0.8% capped at $5;
                cards cost 2.9% + 30¢, which adds up fast on large payments.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rail-mode">Allowed methods</Label>
                <Select value={feeForm.railMode}
                  onValueChange={(v) => setFeeForm((f) => ({ ...f, railMode: v as typeof f.railMode }))}>
                  <SelectTrigger id="rail-mode" className="w-64" data-testid="select-rail-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Bank transfer (ACH) + card</SelectItem>
                    <SelectItem value="ach_only">Bank transfer (ACH) only</SelectItem>
                    <SelectItem value="card_only">Card only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {feeForm.railMode === "both" && (
                <div className="space-y-1.5">
                  <Label htmlFor="ach-only-over">ACH only above ($)</Label>
                  <Input id="ach-only-over" type="number" min={0} step="100" className="w-36"
                    placeholder="e.g. 5000" data-testid="input-ach-only-over"
                    value={feeForm.achOnlyOver}
                    onChange={(e) => setFeeForm((f) => ({ ...f, achOnlyOver: e.target.value }))} />
                </div>
              )}
            </div>
            {feeForm.railMode === "both" && (
              <p className="text-xs text-muted-foreground">
                Leave the threshold blank to always offer both. With a threshold, payments at or above
                it are bank-transfer only.
              </p>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={saveFee} disabled={savePaySettings.isPending}
                data-testid="button-save-rail-policy">
                {savePaySettings.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save payment methods
              </Button>
            </div>
          </div>

          {/* Card processing fee passthrough — ACH always stays fee-free. */}
          <div className="mt-6 border-t pt-4 space-y-3" data-testid="section-card-fee">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Pass the card processing fee to the client</div>
                <p className="text-xs text-muted-foreground">
                  Off = you absorb the fee yourself (some contractors waive it to win more work). On = the client pays it on card checkouts.
                </p>
                <p className="text-xs text-muted-foreground">
                  Before any card checkout starts, the client sees the rate and the dollar amount in a pop-up with the
                  no-fee bank option beside it; the fee rides on the Stripe receipt as its own "Card processing fee"
                  line. Applies to invoices, deposits and the links you make from Take a payment. Bank transfer (ACH)
                  is always fee-free. Card-network rules cap a pass-through at your actual cost (3% for Visa) and a few
                  states restrict it — check yours.
                </p>
              </div>
              <Switch
                checked={feeForm.passFeeToClient}
                onCheckedChange={(v) => setFeeForm((f) => ({ ...f, passFeeToClient: v }))}
                aria-label="Pass the card processing fee to the client" data-testid="switch-pass-fee"
              />
            </div>
            {feeForm.passFeeToClient && (
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="surcharge-pct">Card surcharge (%)</Label>
                  <Input id="surcharge-pct" type="number" min={0} max={10} step="0.1" className="w-32"
                    placeholder="e.g. 3" data-testid="input-surcharge-pct"
                    value={feeForm.surchargePct}
                    onChange={(e) => setFeeForm((f) => ({ ...f, surchargePct: e.target.value }))} />
                </div>
                <Button size="sm" onClick={saveFee} disabled={savePaySettings.isPending}
                  data-testid="button-save-card-fee">
                  {savePaySettings.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save fee setting
                </Button>
              </div>
            )}
            {!feeForm.passFeeToClient && (
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={saveFee} disabled={savePaySettings.isPending}
                  data-testid="button-save-card-fee-off">
                  {savePaySettings.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save fee setting
                </Button>
              </div>
            )}
          </div>

          {/* Reconciliation prompts — off-platform money gets asked about on a schedule. */}
          <div className="mt-6 border-t pt-4 space-y-3" data-testid="section-reconcile">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Payment reconciliation prompts</div>
                <p className="text-xs text-muted-foreground">
                  After a job is approved, and again after it is closed out, the PM / staff get a pop-up asking how the deposit
                  (or final payment) was received until it is recorded or marked "nothing was due". Online payments clear it on
                  their own; a check, cash or wire needs the payment type entered.
                </p>
              </div>
              <Switch checked={recForm.enabled} onCheckedChange={(v) => setRecForm((f) => ({ ...f, enabled: v }))}
                aria-label="Payment reconciliation prompts" data-testid="switch-reconcile" />
            </div>
            {recForm.enabled && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rec-approval-days">Days after approval (deposit)</Label>
                  <Input id="rec-approval-days" value={recForm.approvalDays} placeholder="1, 3, 5" data-testid="input-reconcile-approval-days"
                    onChange={(e) => setRecForm((f) => ({ ...f, approvalDays: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rec-closeout-days">Days after close-out (final payment)</Label>
                  <Input id="rec-closeout-days" value={recForm.closeoutDays} placeholder="1, 3, 5" data-testid="input-reconcile-closeout-days"
                    onChange={(e) => setRecForm((f) => ({ ...f, closeoutDays: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rec-notify">Who is asked</Label>
                  <Select value={recForm.notify} onValueChange={(v) => setRecForm((f) => ({ ...f, notify: v as typeof f.notify }))}>
                    <SelectTrigger id="rec-notify" data-testid="select-reconcile-notify"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pm">The project manager (else sales, else the owner)</SelectItem>
                      <SelectItem value="pm_sales">The project manager and the sales rep</SelectItem>
                      <SelectItem value="owners">The project manager and every owner</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rec-photo">Photo or copy of the check</Label>
                  <Select value={recForm.photo} onValueChange={(v) => setRecForm((f) => ({ ...f, photo: v as typeof f.photo }))}>
                    <SelectTrigger id="rec-photo" data-testid="select-reconcile-photo"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="optional">Ask for one (optional)</SelectItem>
                      <SelectItem value="required">Require one for check and cash</SelectItem>
                      <SelectItem value="off">Don't ask</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <span className="text-muted-foreground">Besides the in-app pop-up, also send:</span>
                  <label className="flex items-center gap-2"><Switch checked={recForm.email} onCheckedChange={(v) => setRecForm((f) => ({ ...f, email: v }))} aria-label="Email the reminder" data-testid="switch-reconcile-email" /> Email</label>
                  <label className="flex items-center gap-2"><Switch checked={recForm.sms} onCheckedChange={(v) => setRecForm((f) => ({ ...f, sms: v }))} aria-label="Text the reminder" data-testid="switch-reconcile-sms" /> Text message</label>
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <Button size="sm" disabled={savePaySettings.isPending} data-testid="button-save-reconcile"
                onClick={() => savePaySettings.mutate({ reconcile: {
                  enabled: recForm.enabled, approvalDays: recForm.approvalDays, closeoutDays: recForm.closeoutDays,
                  photo: recForm.photo, notify: recForm.notify, channels: { email: recForm.email, sms: recForm.sms },
                } })}>
                {savePaySettings.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save reconciliation prompts
              </Button>
            </div>
          </div>

          {/* Receipts — what the client gets automatically after any payment. */}
          <div className="mt-6 border-t pt-4 space-y-3" data-testid="section-receipts">
            <div>
              <div className="text-sm font-medium">Automatic receipts</div>
              <p className="text-xs text-muted-foreground">
                After any payment — online, or recorded by hand — the client gets a receipt. Email is on by default; add a text
                message, or turn both off to disable automatic receipts (you can still send one from an invoice).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <label className="flex items-center gap-2"><Switch checked={rcptForm.email} onCheckedChange={(v) => setRcptForm((f) => ({ ...f, email: v }))} aria-label="Email receipts" data-testid="switch-receipt-email" /> Email receipt</label>
              <label className="flex items-center gap-2"><Switch checked={rcptForm.sms} onCheckedChange={(v) => setRcptForm((f) => ({ ...f, sms: v }))} aria-label="Text receipts" data-testid="switch-receipt-sms" /> Text receipt to their cell phone</label>
              {!rcptForm.email && !rcptForm.sms && <span className="text-xs text-amber-700 dark:text-amber-400" data-testid="text-receipts-off">Automatic receipts are disabled.</span>}
            </div>
            <div className="flex justify-end">
              <Button size="sm" disabled={savePaySettings.isPending} data-testid="button-save-receipts"
                onClick={() => savePaySettings.mutate({ receipts: { email: rcptForm.email, sms: rcptForm.sms } })}>
                {savePaySettings.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save receipts
              </Button>
            </div>
          </div>

          {/* Check / Zelle — how a client pays without a card or bank link. */}
          <div className="mt-6 border-t pt-4 space-y-3" data-testid="section-offline-instructions">
            <div>
              <div className="text-sm font-medium">How to pay by check or Zelle</div>
              <p className="text-xs text-muted-foreground">
                Shown on every payment request and its email, next to the online payment button. For example: who checks are
                payable to, where to mail them, and the Zelle email or phone. Leave it empty to show nothing.
              </p>
            </div>
            <Textarea rows={4} maxLength={1500} value={offlineText} onChange={(e) => setOfflineText(e.target.value)}
              placeholder={"Checks payable to …, mailed to …\nZelle: …"} data-testid="textarea-offline-instructions" />
            <div className="flex justify-end">
              <Button size="sm" disabled={savePaySettings.isPending} data-testid="button-save-offline-instructions"
                onClick={() => savePaySettings.mutate({ offlineInstructions: offlineText.trim() || null })}>
                {savePaySettings.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save
              </Button>
            </div>
            <DivisionOfflinePay />
          </div>

          {/* Financing links — the primary one shows on estimates & invoices. */}
          <div className="mt-6 border-t pt-4 space-y-3" data-testid="section-financing">
            <div>
              <div className="text-sm font-medium flex items-center gap-1">Financing links<InfoTip k="financing" /></div>
              <p className="text-xs text-muted-foreground">
                Up to 10 lender or partner links. The primary one appears as "Finance this project →"
                on your estimates, invoices and the client portal.
              </p>
            </div>
            {finLinks.length > 0 && (
              <div className="space-y-2">
                {finLinks.map((l, i) => (
                  <div key={`${l.label}-${i}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
                    data-testid={`row-financing-${i}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        <span className="truncate">{l.label}</span>
                        {l.primary && <StatusPill tone="info" className="shrink-0" data-testid={`pill-primary-financing-${i}`}>Primary</StatusPill>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{l.url}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!l.primary && (
                        <Button size="sm" variant="outline"
                          onClick={() => saveLinks(finLinks.map((x, j) => ({ ...x, primary: j === i })))}
                          disabled={savePaySettings.isPending} data-testid={`button-primary-financing-${i}`}>
                          Set primary
                        </Button>
                      )}
                      <Button size="sm" variant="ghost"
                        onClick={() => {
                          const next = finLinks.filter((_, j) => j !== i);
                          // Never leave the list without a primary.
                          if (next.length && !next.some((x) => x.primary)) next[0] = { ...next[0], primary: true };
                          saveLinks(next);
                        }}
                        disabled={savePaySettings.isPending} aria-label={`Remove ${l.label}`} data-testid={`button-remove-financing-${i}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {finLinks.length < 10 && (
              <div className="flex flex-wrap gap-2">
                <Input placeholder="Label (e.g. GreenSky financing)" aria-label="Financing link label" className="sm:w-56"
                  data-testid="input-financing-label"
                  value={newLink.label} onChange={(e) => setNewLink((n) => ({ ...n, label: e.target.value }))} />
                <Input placeholder="https://…" aria-label="Financing link URL" className="flex-1 min-w-48"
                  data-testid="input-financing-url"
                  value={newLink.url} onChange={(e) => setNewLink((n) => ({ ...n, url: e.target.value }))} />
                <Button size="sm" variant="outline" className="shrink-0"
                  disabled={savePaySettings.isPending || !newLink.label.trim() || !/^https?:\/\//i.test(newLink.url.trim())}
                  data-testid="button-add-financing"
                  onClick={() => {
                    const next = [...finLinks, {
                      label: newLink.label.trim(), url: newLink.url.trim(), primary: finLinks.length === 0,
                    }];
                    setNewLink({ label: "", url: "" });
                    saveLinks(next);
                  }}>
                  Add link
                </Button>
              </div>
            )}
          </div>
          </>
          )}
        </CardContent>
      </Card>

      {/* ── Calendar sync ───────────────────────────────────────────────── */}
      <Card data-testid="card-calendar">
        <CardHeader>
          <SectionTitle
            icon={CalendarDays}
            title="Calendar"
            infoKey="settings-calendar"
            description="Your schedule in the calendar app you already use — subscribe anywhere, or push to Google Calendar."
          />
        </CardHeader>
        <CardContent className="space-y-6">
          {(calendarParam === "connected=1" || calendarParam === "connected") && gcal && (
            <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm"
              data-testid="text-google-calendar-connected">
              Google Calendar connected. Hit "Sync now" to push your schedule.
            </p>
          )}
          {calendarParam?.startsWith("error=") && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
              data-testid="text-google-calendar-error">
              Google Calendar connection failed: {decodeURIComponent(calendarParam.slice(6))}
            </p>
          )}

          {/* Universal iCal feed */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Subscribe from any calendar app</div>
            <p className="text-xs text-muted-foreground">
              Works with Apple Calendar, Outlook, Google Calendar and anything else that reads an iCal feed.
              Calendar apps can't log in, so <strong>the token in this URL is the password</strong> — anyone
              with the link can read the schedule. Regenerate it to cut off every old copy.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={calFeed?.url ?? ""} data-testid="input-calendar-feed-url"
                onFocus={(e) => e.target.select()} />
              <Button size="sm" variant="outline" className="shrink-0" data-testid="button-copy-calendar-feed"
                disabled={!calFeed?.url}
                onClick={async () => {
                  if (!calFeed?.url) return;
                  try {
                    await navigator.clipboard.writeText(calFeed.url);
                    toast({ title: "Copied" });
                  } catch {
                    toast({ title: "Copy failed", description: "Select the feed URL and copy it by hand.", variant: "destructive" });
                  }
                }}>
                <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
              </Button>
              <Button size="sm" variant="outline" className="shrink-0" data-testid="button-regenerate-calendar-feed"
                onClick={() => {
                  confirmAction({
                    id: "regenerate-calendar-feed",
                    title: "Regenerate the calendar feed link?",
                    description: "You get a new feed link, and every calendar subscribed to the old one stops updating. This can't be undone — the old link can't be brought back, so each calendar has to be subscribed again with the new link.",
                    confirmLabel: "Regenerate link",
                    onConfirm: () => rotateFeed.mutate(),
                  });
                }}
                disabled={rotateFeed.isPending}>
                {rotateFeed.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Regenerate
              </Button>
            </div>
          </div>

          {/* Google Calendar push */}
          <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">Company Google Calendar (push sync)</div>
                <p className="text-xs text-muted-foreground">
                  The company-wide calendar: EVERY appointment, written into a dedicated "ConstructHub CRM"
                  calendar in the connected Google account. Optional — each team member can also connect
                  their own calendar (just their assignments) under Team &amp; Company → My profile.
                </p>
              </div>
              {gcalStatus && (
                <StatusPill tone={gcal ? "success" : "neutral"} data-testid="pill-google-calendar-status">
                  {gcal ? "Connected" : "Not connected"}
                </StatusPill>
              )}
            </div>

            {gcalStatus && !gcalStatus.configured && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3"
                data-testid="text-google-calendar-not-configured">
                <div className="text-sm font-medium">Google Calendar sync isn’t switched on yet</div>
                <p className="text-xs text-muted-foreground mt-1">
                  We’re switching it on; there is nothing for you to do. Your schedule keeps working here meanwhile.
                  <AdminSetupNote>
                    missing environment {(gcalStatus.missing ?? []).length === 1 ? "variable" : "variables"}{" "}
                    <code>{(gcalStatus.missing ?? []).join(", ")}</code> — add {(gcalStatus.missing ?? []).length === 1 ? "it" : "them"} to
                    the server <code>.env</code> and restart (the sign-in flow’s Google OAuth client, with the{" "}
                    <code>calendar.app.created</code> scope authorized).
                  </AdminSetupNote>
                </p>
              </div>
            )}

            {gcal ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">
                  Connected {new Date(gcal.connectedAt).toLocaleDateString()}
                  {gcal.lastSyncAt ? ` · last synced ${new Date(gcal.lastSyncAt).toLocaleString()}` : " · not synced yet"}
                </div>
                {gcal.lastSyncError && (
                  <p className="text-xs text-destructive" data-testid="text-google-calendar-sync-error">
                    Last sync failed: {gcal.lastSyncError}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => googleSync.mutate()}
                    disabled={googleSync.isPending} data-testid="button-sync-google-calendar">
                    {googleSync.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                    Sync now
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => googleDisconnect.mutate()}
                    disabled={googleDisconnect.isPending} data-testid="button-disconnect-google-calendar">
                    <Unplug className="h-3.5 w-3.5 mr-1.5" /> Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" onClick={() => googleConnect.mutate()}
                disabled={googleConnect.isPending || gcalStatus?.configured === false}
                data-testid="button-connect-google-calendar">
                {googleConnect.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Connect Google Calendar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Integrations moved to their own page ──────────────────────── */}
      <Card data-testid="card-integrations-moved">
        <CardContent className="p-5 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Blocks className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">Integrations have moved</div>
            <div className="text-xs text-muted-foreground">
              HOVER, API keys and webhooks now live on the Integrations page, alongside Stripe and Google Calendar.
            </div>
          </div>
          <Link href="/crm/integrations" data-testid="link-integrations"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0">
            Open <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>

      {/* ── Shortcuts ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">Team &amp; permissions</div>
              <div className="text-xs text-muted-foreground">Members, roles, invitations and per-person overrides.</div>
            </div>
            <Link href="/crm/team" data-testid="link-team"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0">
              Open <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BookOpen className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">Price book</div>
              <div className="text-xs text-muted-foreground">Materials, labor rates, assemblies and packages.</div>
            </div>
            <Link href="/crm/pricebook" data-testid="link-pricebook"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0">
              Open <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UploadCloud className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">Import your data</div>
              <div className="text-xs text-muted-foreground">Clients, estimates and invoices from Jobber, QuickBooks, Leap or Excel.</div>
            </div>
            <Link href="/crm/migrate" data-testid="link-migrate"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0">
              Open <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Ruler className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">Measurement reports</div>
              <div className="text-xs text-muted-foreground">Import HOVER or CladAI reports — the client is created automatically.</div>
            </div>
            <Link href="/crm/reports" data-testid="link-reports"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0">
              Open <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* ── Lead sources (read-only) ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <SectionTitle
            icon={Tag}
            title="Lead sources"
            infoKey="lead-sources"
            description="Where your clients come from. Your web form and the Call Assistant set it; there is no picker on the client page."
          />
        </CardHeader>
        <CardContent>
          {leadSourcesError ? (
            <p className="text-sm text-destructive">Couldn't load lead sources — refresh to try again.</p>
          ) : !leadSources?.length ? (
            <EmptyState compact icon={Tag} title="No lead sources yet"
              description="Sources appear here as they're added to clients." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {leadSources.map((s) => (
                <StatusPill key={s.id} tone="neutral" data-testid={`row-lead-source-${s.id}`}>
                  {s.name}
                </StatusPill>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground/70 pb-2">
        ConstructHUB CRM{" "}
        <a href="/crm-terms" className="hover:underline" data-testid="link-crm-terms">Terms of Service</a>
        <span className="mx-1.5">·</span>
        <a href="/crm-privacy" className="hover:underline" data-testid="link-crm-privacy">Privacy Policy</a>
      </p>
    </CrmPage>
  );
}

/**
 * Settings → Lead visibility by location: per team member, the states and markets whose leads they may see. No
 * boxes ticked = every lead. Owners and seats that run Settings always see everything (server/crm/leads.ts).
 */
/** Per-division check / Zelle text (WA and FL bank differently): each division's own, else the company-wide text above. */
function DivisionOfflinePay() {
  const { toast } = useToast();
  const { data: divisions } = useQuery<any[]>({ queryKey: ["/api/crm/divisions"] });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) =>
      (await apiRequest("PATCH", `/api/crm/divisions/${id}`, { offlinePaymentInstructions: text.trim() || null })).json(),
    onSuccess: (_r, v) => {
      setDrafts((d) => { const n = { ...d }; delete n[v.id]; return n; });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/divisions"] });
      toast({ title: "Saved" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!divisions || divisions.length < 2) return null;
  return (
    <div className="space-y-3 pt-2" data-testid="section-division-offline-instructions">
      <p className="text-xs text-muted-foreground">
        Different details per division? Fill these in — a division left empty uses the text above.
      </p>
      {divisions.map((d) => {
        const stored = String((d.customFields as any)?.offlinePaymentInstructions ?? "");
        const value = drafts[d.id] ?? stored;
        return (
          <div key={d.id} className="space-y-1.5">
            <Label htmlFor={`offline-${d.id}`}>{d.name}{d.code ? ` (${d.code})` : ""}</Label>
            <Textarea id={`offline-${d.id}`} rows={3} maxLength={1500} value={value}
              onChange={(e) => setDrafts((x) => ({ ...x, [d.id]: e.target.value }))}
              placeholder="Empty = the company-wide text above" data-testid={`textarea-offline-${d.code ?? d.id}`} />
            <div className="flex justify-end">
              <Button size="sm" variant="outline" disabled={save.isPending || value === stored}
                onClick={() => save.mutate({ id: d.id, text: value })} data-testid={`button-save-offline-${d.code ?? d.id}`}>
                Save {d.code ?? d.name}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeadVisibilityCard() {
  const { toast } = useToast();
  const { data, isError } = useQuery<{
    members: { id: string; displayName: string | null; email: string | null; role: string; alwaysAll: boolean }[];
    rules: Record<string, { states: string[]; markets: string[]; unknownToo: boolean }>;
    states: { code: string; name: string }[];
    markets: { key: string; name: string; state: string }[];
  }>({ queryKey: ["/api/crm/leads/visibility"] });
  const [draft, setDraft] = useState<Record<string, { states: string[]; markets: string[]; unknownToo: boolean }>>({});
  useEffect(() => { if (data) setDraft(data.rules ?? {}); }, [data]);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/crm/leads/visibility", { rules: draft })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/leads/visibility"] }); toast({ title: "Lead visibility saved" }); },
    onError: (e: any) => toast({ title: "Could not save lead visibility", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const ruleOf = (id: string) => draft[id] ?? { states: [], markets: [], unknownToo: false };
  const toggle = (id: string, kind: "states" | "markets", value: string) => setDraft((d) => {
    const r = { ...(d[id] ?? { states: [], markets: [], unknownToo: false }) };
    const list = new Set(r[kind]); list.has(value) ? list.delete(value) : list.add(value); r[kind] = [...list];
    return { ...d, [id]: r };
  });
  if (isError || !data) return null;
  const people = data.members.filter((m) => !m.alwaysAll);
  return (
    <Card>
      <CardHeader>
        <SectionTitle icon={Users} title="Lead visibility by location"
          description="Choose which states or markets each team member can see leads for. Nothing ticked means every lead. Owners always see everything." />
      </CardHeader>
      <CardContent className="space-y-3" data-testid="section-lead-visibility">
        {!people.length ? (
          <p className="text-sm text-muted-foreground">Only owners on the team so far — add a team member and their lead access shows here.</p>
        ) : people.map((m) => {
          const r = ruleOf(m.id);
          const restricted = r.states.length > 0 || r.markets.length > 0;
          return (
            <div key={m.id} className="rounded-lg border p-3 space-y-2" data-testid={`lead-visibility-${m.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">{m.displayName || m.email} <span className="text-xs font-normal text-muted-foreground">· {m.role}</span></div>
                <span className="text-xs text-muted-foreground">{restricted ? "Sees only the places ticked" : "Sees every lead"}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                <span className="text-xs uppercase tracking-wide text-muted-foreground w-full">States</span>
                {data.states.map((s) => (
                  <label key={s.code} className="flex items-center gap-1.5">
                    <Checkbox checked={r.states.includes(s.code)} onCheckedChange={() => toggle(m.id, "states", s.code)} data-testid={`check-lead-state-${m.id}-${s.code}`} /> {s.name}
                  </label>
                ))}
              </div>
              {data.markets.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground w-full">Markets</span>
                  {data.markets.map((mk) => (
                    <label key={mk.key} className="flex items-center gap-1.5">
                      <Checkbox checked={r.markets.includes(mk.key)} onCheckedChange={() => toggle(m.id, "markets", mk.key)} data-testid={`check-lead-market-${m.id}-${mk.key}`} /> {mk.name} <span className="text-xs text-muted-foreground">{mk.state}</span>
                    </label>
                  ))}
                </div>
              )}
              {restricted && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox checked={r.unknownToo} onCheckedChange={(v) => setDraft((d) => ({ ...d, [m.id]: { ...ruleOf(m.id), unknownToo: v === true } }))} data-testid={`check-lead-unknown-${m.id}`} />
                  Also show leads whose place is unknown
                </label>
              )}
            </div>
          );
        })}
        {people.length > 0 && (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-lead-visibility">
              {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save lead visibility
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Which states the "New HOVER report" notification rings for (owner, 2026-10-19: WA for Alpine). One checkbox per
 * state the company's divisions cover; none checked = every report. Stored as customFields.notificationScopes.
 */
function HoverNotifyStates({ org }: { org: any }) {
  const { toast } = useToast();
  const { data: divisions } = useQuery<any[]>({ queryKey: ["/api/crm/divisions"] });
  const chosen: string[] = ((org?.customFields as any)?.notificationScopes?.hoverReportReady?.states ?? []).map((s: string) => String(s).toUpperCase());
  const states = [...new Set([
    ...((divisions ?? []).map((d) => String(d.state ?? d.code ?? "").trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s))),
    ...chosen,
  ])].sort();
  const save = useMutation({
    mutationFn: async (next: string[]) =>
      (await apiRequest("PATCH", "/api/crm/org", { notificationScopes: { hoverReportReady: next.length ? { states: next } : null } })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/me"] });
      toast({ title: "HOVER report states saved" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!states.length) return null;
  return (
    <div className="mt-3 rounded-md border bg-muted/30 p-3" data-testid="hover-notify-states">
      <div className="text-sm font-medium">New HOVER report — which states</div>
      <div className="text-xs text-muted-foreground mb-2">
        {chosen.length ? `Ringing for ${chosen.join(", ")} only.` : "Ringing for every report, wherever it is."} A report with no state on it always rings.
      </div>
      <div className="flex flex-wrap gap-4">
        {states.map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={chosen.includes(s)}
              disabled={save.isPending}
              onCheckedChange={(v) => save.mutate(v ? [...chosen, s] : chosen.filter((x) => x !== s))}
              data-testid={`checkbox-hover-notify-${s}`}
            />
            {s}
          </label>
        ))}
      </div>
    </div>
  );
}
