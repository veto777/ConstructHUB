import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Settings, Building2, FileText, Bell, CreditCard, Blocks,
  Users, BookOpen, Tag, Loader2, Copy, Trash2, ArrowRight, Landmark, MapPin, UploadCloud, Plus,
  CalendarDays, RefreshCw, Unplug, Ruler, MessageSquare, Lock, DatabaseBackup,
} from "lucide-react";
import {
  CrmPage, CrmPageHeader, StatusPill, EmptyState, ErrorCard, SectionTitle,
} from "@/components/crm-ui";
import { CRM_THEME_COLORS, resolveOrgTheme } from "@shared/theme-colors";

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
] as const;

type NotifKey = (typeof NOTIFICATIONS)[number]["key"];

const emptyToNull = (s: string) => (s.trim() === "" ? null : s.trim());

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
  const { data: leadSources } = useQuery<any[]>({
    queryKey: ["/api/crm/lead-sources"],
    enabled: allowed,
  });
  const { data: divisions } = useQuery<any[]>({
    queryKey: ["/api/crm/divisions"],
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

  // ── Divisions ─────────────────────────────────────────────────────────────
  const emptyDivision = {
    name: "", code: "", email: "", phone: "", website: "",
    addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "",
    licenseNumber: "", licenseState: "", isHeadquarters: false,
    // Sales tax (custom_fields->taxRates): division default + per-city overrides.
    taxDefaultPct: "", taxCities: "",
  };
  const [divForm, setDivForm] = useState(emptyDivision);
  const [editingDivisionId, setEditingDivisionId] = useState<string | null>(null);
  const setD = (k: keyof typeof emptyDivision) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDivForm((d) => ({ ...d, [k]: e.target.value }));

  // "Seattle: 10.1%" per line → { Seattle: 1010 } (basis points, capped at 30%).
  const parseCityRates = (s: string) => {
    const out: Record<string, number> = {};
    for (const line of s.split(/\n+/)) {
      const m = /^\s*([^:]+?)\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*%?\s*$/.exec(line);
      if (m) out[m[1]] = Math.round(Math.min(30, Math.max(0, parseFloat(m[2]))) * 100);
    }
    return out;
  };
  const serializeCityRates = (cities?: Record<string, number> | null) =>
    cities ? Object.entries(cities).map(([k, v]) => `${k}: ${v / 100}%`).join("\n") : "";

  const saveDivision = useMutation({
    mutationFn: async () => {
      const taxDefault = parseFloat(divForm.taxDefaultPct);
      const taxRates = {
        default: divForm.taxDefaultPct.trim() === "" || Number.isNaN(taxDefault)
          ? null
          : Math.round(Math.min(30, Math.max(0, taxDefault)) * 100),
        cities: parseCityRates(divForm.taxCities),
      };
      const hasTax = taxRates.default != null || Object.keys(taxRates.cities).length > 0;
      const body = {
        name: divForm.name.trim(),
        code: divForm.code.trim(),
        email: emptyToNull(divForm.email),
        phone: emptyToNull(divForm.phone),
        website: emptyToNull(divForm.website),
        addressLine1: emptyToNull(divForm.addressLine1),
        addressLine2: emptyToNull(divForm.addressLine2),
        city: emptyToNull(divForm.city),
        state: emptyToNull(divForm.state),
        postalCode: emptyToNull(divForm.postalCode),
        licenseNumber: emptyToNull(divForm.licenseNumber),
        licenseState: emptyToNull(divForm.licenseState),
        isHeadquarters: divForm.isHeadquarters,
      };
      if (editingDivisionId) {
        // taxRates is PATCH-only on the API (merged into custom_fields).
        return (await apiRequest("PATCH", `/api/crm/divisions/${editingDivisionId}`, { ...body, taxRates })).json();
      }
      const created = await (await apiRequest("POST", "/api/crm/divisions", body)).json();
      if (hasTax && created?.id) {
        await apiRequest("PATCH", `/api/crm/divisions/${created.id}`, { taxRates });
      }
      return created;
    },
    onSuccess: () => {
      setDivForm(emptyDivision);
      setEditingDivisionId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/divisions"] });
      toast({ title: editingDivisionId ? "Division updated" : "Division created" });
    },
    onError: (e: any) => toast({ title: "Could not save division", description: String(e.message ?? e), variant: "destructive" }),
  });

  const setHq = useMutation({
    mutationFn: async (id: string) =>
      (await apiRequest("PATCH", `/api/crm/divisions/${id}`, { isHeadquarters: true })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/divisions"] });
      toast({ title: "Headquarters updated" });
    },
    onError: (e: any) => toast({ title: "Could not update", description: String(e.message ?? e), variant: "destructive" }),
  });

  const startEditDivision = (d: any) => {
    const s = (v: any) => v ?? "";
    const taxRates = (d.customFields as any)?.taxRates;
    setDivForm({
      name: s(d.name), code: s(d.code), email: s(d.email), phone: s(d.phone), website: s(d.website),
      addressLine1: s(d.addressLine1), addressLine2: s(d.addressLine2),
      city: s(d.city), state: s(d.state), postalCode: s(d.postalCode),
      licenseNumber: s(d.licenseNumber), licenseState: s(d.licenseState),
      isHeadquarters: d.isHeadquarters === true,
      taxDefaultPct: taxRates?.default != null ? String(taxRates.default / 100) : "",
      taxCities: serializeCityRates(taxRates?.cities),
    });
    setEditingDivisionId(d.id);
  };

  // ── Company profile ───────────────────────────────────────────────────────
  const [company, setCompany] = useState<Record<string, string>>({});
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
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/me"] });
      toast({ title: "Company profile saved" });
    },
    onError: (e: any) => toast({ title: "Could not save company profile", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── Company theme — one of 20 preset accents (customFields.themeColor),
  //    saved instantly on click; applies to client-facing documents only. ────
  const saveTheme = useMutation({
    mutationFn: async (id: string) => (await apiRequest("PATCH", "/api/crm/org", { themeColor: id })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      toast({ title: "Theme saved" });
    },
    onError: (e: any) => toast({ title: "Could not save theme", description: String(e.message ?? e), variant: "destructive" }),
  });
  // Which number this company's texts come FROM.
  const [senderForm, setSenderForm] = useState<{
    mode: "platform" | "dedicated" | "byo"; fromNumber: string; spaceUrl: string; projectId: string; apiToken: string;
  }>({ mode: "platform", fromNumber: "", spaceUrl: "", projectId: "", apiToken: "" });
  useEffect(() => {
    const sms = (org?.customFields as any)?.sms;
    setSenderForm({
      mode: sms?.mode === "dedicated" || sms?.mode === "byo" ? sms.mode : "platform",
      fromNumber: sms?.fromNumber ?? "",
      spaceUrl: sms?.spaceUrl ?? "",
      projectId: sms?.projectId ?? "",
      apiToken: "", // write-only: never echoed back
    });
  }, [org?.customFields]);

  const saveSender = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/crm/sms/sender", {
      mode: senderForm.mode,
      fromNumber: senderForm.fromNumber.trim() || null,
      spaceUrl: senderForm.spaceUrl.trim() || null,
      projectId: senderForm.projectId.trim() || null,
      apiToken: senderForm.apiToken.trim() || null,
    })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sms/status"] });
      setSenderForm((f) => ({ ...f, apiToken: "" }));
      toast({ title: "Text sender saved" });
    },
    onError: (e: any) => toast({ title: "Could not save the sender", description: String(e.message ?? e), variant: "destructive" }),
  });

  // Default for "also text the estimate" when sending a bid.
  const saveSmsEstimates = useMutation({
    mutationFn: async (on: boolean) => (await apiRequest("PATCH", "/api/crm/org", { smsEstimates: on })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      toast({ title: "Estimate texting saved" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: String(e.message ?? e), variant: "destructive" }),
  });

  // Org-default bid discounts — the standard offers every sent estimate
  // starts with (the per-estimate Discounts dialog can still adjust one bid).
  const DISCOUNT_PRESETS = [
    { code: "marketing", label: "Marketing discount", percentBps: 100, conditions: "Yard signage during the job + 1 month after, and an honest review." },
    { code: "military", label: "Military discount", percentBps: 200, conditions: "Military ID required." },
    { code: "pay_in_full", label: "Pay-in-full discount", percentBps: 500, conditions: "Paid in full immediately." },
    { code: "bundle", label: "Bundle discount (trifecta)", percentBps: 500, conditions: "Siding + roofing + windows — all three required." },
  ];
  const [discForm, setDiscForm] = useState<{ code: string; label: string; percentBps: number; conditions: string | null; enabled: boolean }[]>([]);
  const [discCustom, setDiscCustom] = useState({ label: "", pct: "", conditions: "" });
  useEffect(() => {
    const saved = (org?.customFields as any)?.discountDefaults;
    if (Array.isArray(saved) && saved.length) {
      setDiscForm(saved.map((o: any) => ({ code: o.code, label: o.label, percentBps: o.percentBps, conditions: o.conditions ?? null, enabled: o.enabled !== false })));
    } else {
      setDiscForm(DISCOUNT_PRESETS.map((p) => ({ ...p, enabled: false })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.customFields]);
  const saveDiscounts = useMutation({
    mutationFn: async (next: typeof discForm) =>
      (await apiRequest("PATCH", "/api/crm/org", { discountDefaults: next })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      toast({ title: "Bid discounts saved", description: "New estimates start with these offers when sent." });
    },
    onError: (e: any) => toast({ title: "Could not save discounts", description: String(e.message ?? e), variant: "destructive" }),
  });

  // Owner text alerts on signed approvals + payments (opt-in, costs money).
  const saveSmsAlerts = useMutation({
    mutationFn: async (on: boolean) => (await apiRequest("PATCH", "/api/crm/org", { smsAlerts: on })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      toast({ title: "Text alerts saved" });
    },
    onError: (e: any) => toast({ title: "Could not save text alerts", description: String(e.message ?? e), variant: "destructive" }),
  });

  // The main (band) colour the accent pairs with — black or white.
  const saveThemeBase = useMutation({
    mutationFn: async (base: "black" | "white") =>
      (await apiRequest("PATCH", "/api/crm/org", { themeBase: base })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      toast({ title: "Theme saved" });
    },
    onError: (e: any) => toast({ title: "Could not save theme", description: String(e.message ?? e), variant: "destructive" }),
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
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/me"] });
      toast({ title: "Logo uploaded" });
    },
    onError: (e: any) => toast({ title: "Could not upload logo", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── Estimate & invoice defaults ───────────────────────────────────────────
  const [defaults, setDefaults] = useState({
    estimateFooter: "", invoiceFooter: "", termsAndConditions: "",
    warrantyText: "", depositPct: "", taxPct: "",
  });
  useEffect(() => {
    if (!org) return;
    setDefaults({
      estimateFooter: org.estimateFooter ?? "",
      invoiceFooter: org.invoiceFooter ?? "",
      termsAndConditions: org.termsAndConditions ?? "",
      warrantyText: org.warrantyText ?? "",
      depositPct: org.defaultDepositBps ? String(org.defaultDepositBps / 100) : "",
      taxPct: org.defaultTaxRateBps ? String(org.defaultTaxRateBps / 100) : "",
    });
  }, [org?.id]);

  const saveDefaults = useMutation({
    mutationFn: async () => {
      const pct = parseFloat(defaults.depositPct);
      const taxPctNum = parseFloat(defaults.taxPct);
      return (await apiRequest("PATCH", "/api/crm/org", {
        estimateFooter: emptyToNull(defaults.estimateFooter),
        invoiceFooter: emptyToNull(defaults.invoiceFooter),
        termsAndConditions: emptyToNull(defaults.termsAndConditions),
        warrantyText: emptyToNull(defaults.warrantyText),
        defaultDepositBps: defaults.depositPct.trim() === "" || Number.isNaN(pct)
          ? null
          : Math.round(Math.min(100, Math.max(0, pct)) * 100),
        defaultTaxRateBps: defaults.taxPct.trim() === "" || Number.isNaN(taxPctNum)
          ? null
          : Math.round(Math.min(30, Math.max(0, taxPctNum)) * 100),
      })).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      toast({ title: "Defaults saved" });
    },
    onError: (e: any) => toast({ title: "Could not save defaults", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── Notifications ─────────────────────────────────────────────────────────
  const notifPrefs: Record<string, boolean> =
    (org?.customFields as any)?.notificationPrefs ?? {};
  const notifOn = (k: NotifKey) => notifPrefs[k] !== false;

  const saveNotif = useMutation({
    mutationFn: async (patch: Record<string, boolean>) =>
      (await apiRequest("PATCH", "/api/crm/org", { notificationPrefs: patch })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      toast({ title: "Notification preferences saved" });
    },
    onError: (e: any) => toast({ title: "Could not save notifications", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── SMS (SignalWire) ──────────────────────────────────────────────────────
  // Honest configuration state: the server names the missing env vars; the
  // test-text control only lights up when texting can actually work.
  const canIntegrations = me?.permissions?.manageIntegrations === true;
  const { data: smsStatus } = useQuery<any>({
    queryKey: ["/api/crm/sms/status"],
    enabled: allowed,
  });
  const [smsTestTo, setSmsTestTo] = useState("");
  const smsTest = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/crm/sms/test", { to: smsTestTo.trim() })).json(),
    onSuccess: (r: any) =>
      toast({ title: "Test text sent", description: `Delivered via ${r.provider} to ${r.to}.` }),
    onError: (e: any) => toast({ title: "Test text failed", description: String(e.message ?? e), variant: "destructive" }),
  });

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
    mutationFn: async (body: { enabled: boolean; floorBps: number | null }) =>
      (await apiRequest("PUT", "/api/crm/org/price-floor-lock", body)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      toast({ title: "Price lock saved" });
    },
    onError: (e: any) => toast({ title: "Could not save the price lock", description: String(e.message ?? e), variant: "destructive" }),
  });

  const lockBps = () => {
    const pct = parseFloat(floorPct);
    return floorPct.trim() === "" || Number.isNaN(pct) ? null : Math.round(Math.min(100, Math.max(0, pct)) * 100);
  };

  // ── Auto-backup (owner only) ──────────────────────────────────────────────
  // custom_fields->'backup' — the server merges on save, so lastSentAt and
  // lastError come back on the org and render read-only below.
  const backupCfg: { lastSentAt?: string | null; lastError?: string | null } =
    (org?.customFields as any)?.backup ?? {};
  const [backupForm, setBackupForm] = useState({
    enabled: false,
    frequency: "weekly" as "weekly" | "biweekly",
    format: "csv" as "csv" | "xlsx",
    email: "",
  });
  useEffect(() => {
    if (!org) return;
    const b = (org.customFields as any)?.backup ?? {};
    setBackupForm({
      enabled: b.enabled === true,
      frequency: b.frequency === "biweekly" ? "biweekly" : "weekly",
      format: b.format === "xlsx" ? "xlsx" : "csv",
      email: b.email ?? org.email ?? me?.member?.email ?? "",
    });
    // Only re-seed the form when the org itself changes, not on every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);

  const saveBackup = useMutation({
    mutationFn: async () =>
      (await apiRequest("PUT", "/api/crm/backups/settings", backupForm)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      toast({ title: "Backup settings saved" });
    },
    onError: (e: any) => toast({ title: "Could not save backup settings", description: String(e.message ?? e), variant: "destructive" }),
  });

  const sendBackupNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/backups/send-now", {})).json(),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      toast({
        title: "Backup sent",
        description: `${r.rows.clients} clients, ${r.rows.estimates} estimates, ${r.rows.invoices} invoices · ${(r.bytes / 1024).toFixed(1)} KB to ${r.recipient}`,
      });
    },
    onError: (e: any) => toast({ title: "Backup failed", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── Payments: card fee passthrough + financing links ──────────────────────
  const { data: paySettings } = useQuery<any>({
    queryKey: ["/api/crm/payments/settings"],
    enabled: allowed,
  });
  const [feeForm, setFeeForm] = useState({
    passFeeToClient: false, surchargePct: "",
    railMode: "both" as "both" | "ach_only" | "card_only", achOnlyOver: "",
  });
  const [finLinks, setFinLinks] = useState<{ label: string; url: string; primary?: boolean }[]>([]);
  const [newLink, setNewLink] = useState({ label: "", url: "" });
  useEffect(() => {
    if (!paySettings) return;
    setFeeForm({
      passFeeToClient: paySettings.payments?.passFeeToClient === true,
      surchargePct: paySettings.payments?.surchargeBps ? String(paySettings.payments.surchargeBps / 100) : "",
      railMode: paySettings.payments?.railMode === "ach_only" || paySettings.payments?.railMode === "card_only"
        ? paySettings.payments.railMode : "both",
      achOnlyOver: paySettings.payments?.achOnlyOverCents ? String(paySettings.payments.achOnlyOverCents / 100) : "",
    });
    setFinLinks(paySettings.financingLinks ?? []);
  }, [paySettings]);

  const savePaySettings = useMutation({
    mutationFn: async (body: any) => (await apiRequest("PUT", "/api/crm/payments/settings", body)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/payments/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      toast({ title: "Payment settings saved" });
    },
    onError: (e: any) => toast({ title: "Could not save payment settings", description: String(e.message ?? e), variant: "destructive" }),
  });

  const saveFee = () => {
    const pct = parseFloat(feeForm.surchargePct);
    const over = parseFloat(feeForm.achOnlyOver);
    savePaySettings.mutate({
      payments: {
        passFeeToClient: feeForm.passFeeToClient,
        surchargeBps: feeForm.surchargePct.trim() === "" || Number.isNaN(pct)
          ? null
          : Math.round(Math.min(10, Math.max(0, pct)) * 100),
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
    onError: (e: any) => toast({ title: "Could not regenerate", description: String(e.message ?? e), variant: "destructive" }),
  });

  const googleConnect = useMutation({
    mutationFn: async () => (await apiRequest("GET", "/api/crm/calendar/google/connect", undefined)).json(),
    onSuccess: (r: any) => { if (r.url) window.location.href = r.url; },
    onError: (e: any) => toast({ title: "Can't start Google connect", description: String(e.message ?? e), variant: "destructive" }),
  });

  const googleSync = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/calendar/google/sync", {})).json(),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/calendar/google/status"] });
      toast({ title: "Synced to Google Calendar", description: `${r.total ?? 0} appointments pushed (${r.upserted ?? 0} written, ${r.deleted ?? 0} removed).` });
    },
    onError: (e: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/calendar/google/status"] });
      toast({ title: "Sync failed", description: String(e.message ?? e), variant: "destructive" });
    },
  });

  const googleDisconnect = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/calendar/google/disconnect", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/calendar/google/status"] });
      toast({ title: "Google Calendar disconnected" });
    },
    onError: (e: any) => toast({ title: "Could not disconnect", description: String(e.message ?? e), variant: "destructive" }),
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
  const calendarParam = new URLSearchParams(window.location.search).get("calendar");

  return (
    <CrmPage className="max-w-4xl">
      <CrmPageHeader
        icon={Settings}
        title="Settings"
        infoKey="settings"
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
                {company.logoUrl && (
                  <img src={company.logoUrl} alt="Company logo" data-testid="img-company-logo"
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

      {/* ── Divisions ─────────────────────────────────────────────────── */}
      <Card data-testid="card-divisions">
        <CardHeader>
          <SectionTitle
            icon={MapPin}
            title="Divisions"
            infoKey="divisions"
            description="Operating arms of your company (e.g. a WA headquarters and a FL division). A project's division sets the name, address and license that print on its estimates and invoices — and admins can be scoped to one."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {divisions && divisions.length > 0 && (
            <div className="space-y-2">
              {divisions.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
                  data-testid={`row-division-${d.id}`}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2 min-w-0">
                      {/* The name truncates; the pills never get pushed off-screen. */}
                      <span className="truncate">{d.name}</span>
                      <StatusPill tone="neutral" className="shrink-0">{d.code}</StatusPill>
                      {d.isHeadquarters && <StatusPill tone="info" className="shrink-0" data-testid={`pill-hq-${d.id}`}>HQ</StatusPill>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[d.addressLine1, d.city, d.state].filter(Boolean).join(", ") || "No address — falls back to the company's"}
                      {d.licenseNumber ? ` · License ${d.licenseNumber}${d.licenseState ? ` (${d.licenseState})` : ""}` : ""}
                      {d.website ? ` · ${d.website}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!d.isHeadquarters && (
                      <Button size="sm" variant="outline" onClick={() => setHq.mutate(d.id)}
                        disabled={setHq.isPending} data-testid={`button-set-hq-${d.id}`}>
                        Set as HQ
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => startEditDivision(d)}
                      data-testid={`button-edit-division-${d.id}`}>
                      Edit
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="text-sm font-medium">{editingDivisionId ? "Edit division" : "Add a division"}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="div-name">Name</Label>
                <Input id="div-name" placeholder="e.g. Alpine Exteriors — Florida"
                  data-testid="input-division-name" value={divForm.name} onChange={setD("name")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="div-code">Code</Label>
                <Input id="div-code" placeholder="e.g. FL" data-testid="input-division-code"
                  value={divForm.code} onChange={setD("code")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="div-address1">Address</Label>
                <Input id="div-address1" data-testid="input-division-address1"
                  value={divForm.addressLine1} onChange={setD("addressLine1")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="div-city">City</Label>
                <Input id="div-city" data-testid="input-division-city"
                  value={divForm.city} onChange={setD("city")} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="div-state">State</Label>
                  <Input id="div-state" data-testid="input-division-state"
                    value={divForm.state} onChange={setD("state")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="div-postal">ZIP</Label>
                  <Input id="div-postal" data-testid="input-division-postal"
                    value={divForm.postalCode} onChange={setD("postalCode")} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="div-license">License #</Label>
                  <Input id="div-license" data-testid="input-division-license-number"
                    value={divForm.licenseNumber} onChange={setD("licenseNumber")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="div-license-state">License state</Label>
                  <Input id="div-license-state" data-testid="input-division-license-state"
                    value={divForm.licenseState} onChange={setD("licenseState")} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="div-email">Email (optional)</Label>
                <Input id="div-email" type="email" data-testid="input-division-email"
                  value={divForm.email} onChange={setD("email")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="div-phone">Phone (optional)</Label>
                <Input id="div-phone" data-testid="input-division-phone"
                  value={divForm.phone} onChange={setD("phone")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="div-website">Website (optional)</Label>
                <Input id="div-website" data-testid="input-division-website" placeholder="https://…"
                  value={divForm.website} onChange={setD("website")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="div-tax-default">Sales tax — division default (%)</Label>
                <Input id="div-tax-default" type="number" min={0} max={30} step="0.1"
                  data-testid="input-division-tax-default" placeholder="e.g. 7.0"
                  value={divForm.taxDefaultPct} onChange={setD("taxDefaultPct")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="div-tax-cities">City tax overrides (one per line)</Label>
                <Textarea id="div-tax-cities" rows={2} data-testid="textarea-division-tax-cities"
                  placeholder={"Seattle: 10.1%\nTacoma: 9.4%"}
                  value={divForm.taxCities}
                  onChange={(e) => setDivForm((d) => ({ ...d, taxCities: e.target.value }))} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Sales tax resolves city override → division default → company default (Estimate &amp;
              invoice defaults). Rates are managed here in Settings → Divisions — verify with your accountant.
            </p>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={divForm.isHeadquarters}
                onCheckedChange={(v) => setDivForm((d) => ({ ...d, isHeadquarters: v === true }))}
                data-testid="checkbox-division-hq"
              />
              This is the headquarters
            </label>
            <div className="flex justify-end gap-2">
              {editingDivisionId && (
                <Button variant="ghost" onClick={() => { setDivForm(emptyDivision); setEditingDivisionId(null); }}
                  data-testid="button-cancel-division-edit">
                  Cancel
                </Button>
              )}
              <Button onClick={() => saveDivision.mutate()}
                disabled={saveDivision.isPending || !divForm.name.trim() || !divForm.code.trim()}
                data-testid="button-save-division">
                {saveDivision.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingDivisionId ? "Save division" : "Add division"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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
        <CardContent className="divide-y">
          {NOTIFICATIONS.map((n) => (
            <div key={n.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div>
                <div className="text-sm font-medium">{n.label}</div>
                <div className="text-xs text-muted-foreground">{n.description}</div>
              </div>
              <Switch
                checked={notifOn(n.key)}
                onCheckedChange={(v) => saveNotif.mutate({ [n.key]: v })}
                disabled={saveNotif.isPending}
                data-testid={`switch-notif-${n.key}`}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Bid discounts (org defaults) ────────────────────────────────── */}
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
                  {o.label} <span className="text-primary">−{(o.percentBps / 100).toLocaleString("en-US")}%</span>
                </div>
                {o.conditions && <div className="text-xs text-muted-foreground mt-0.5">{o.conditions}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={o.enabled}
                  onCheckedChange={(v) => {
                    const next = discForm.map((x, i) => (i === idx ? { ...x, enabled: v === true } : x));
                    setDiscForm(next); saveDiscounts.mutate(next);
                  }}
                  data-testid={`switch-discount-${o.code}`} />
                {!DISCOUNT_PRESETS.some((p) => p.code === o.code) && (
                  <Button size="sm" variant="ghost" className="text-destructive"
                    onClick={() => { const next = discForm.filter((_, i) => i !== idx); setDiscForm(next); saveDiscounts.mutate(next); }}
                    data-testid={`button-remove-discount-${o.code}`}>
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
              disabled={!discCustom.label.trim() || !(parseFloat(discCustom.pct) > 0) || saveDiscounts.isPending}
              onClick={() => {
                const next = [...discForm, {
                  code: `custom-${Date.now().toString(36)}`,
                  label: discCustom.label.trim(),
                  percentBps: Math.round(Math.min(100, parseFloat(discCustom.pct)) * 100),
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
        </CardContent>
      </Card>

      {/* ── SMS (SignalWire) ───────────────────────────────────────────── */}
      <Card data-testid="card-sms">
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
              {smsStatus?.configured ? (
                <>
                  <div className="font-medium" data-testid="text-sms-configured">
                    Texting via SignalWire from {smsStatus.fromNumber}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Reminder texts and re-engagement alerts send as real SMS.
                  </div>
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
                {smsStatus.configured ? "Configured" : "Not configured"}
              </StatusPill>
            )}
          </div>
          {canIntegrations && (
            <div className="border-t pt-3 space-y-3" data-testid="section-sms-sender">
              <div>
                <div className="text-sm font-medium">Which number your texts come from</div>
                <p className="text-xs text-muted-foreground">
                  Every text names your company either way — this is the number that shows on the client's phone.
                </p>
              </div>
              <Select value={senderForm.mode}
                onValueChange={(v) => setSenderForm((f) => ({ ...f, mode: v as typeof f.mode }))}>
                <SelectTrigger className="w-full sm:w-96" data-testid="select-sms-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="platform">Shared ConstructHUB number (nothing to set up)</SelectItem>
                  <SelectItem value="dedicated">My own number, billed through ConstructHUB</SelectItem>
                  <SelectItem value="byo">My own SignalWire account (billed to me)</SelectItem>
                </SelectContent>
              </Select>

              {senderForm.mode !== "platform" && (
                <div className="space-y-1.5">
                  <Label htmlFor="sms-from">Your text number</Label>
                  <Input id="sms-from" className="w-full sm:w-64" placeholder="+1 360 555 0134"
                    value={senderForm.fromNumber}
                    onChange={(e) => setSenderForm((f) => ({ ...f, fromNumber: e.target.value }))}
                    data-testid="input-sms-from" />
                  {senderForm.mode === "dedicated" && (
                    <p className="text-xs text-muted-foreground">
                      Ask us to provision this number for you — it stays on ConstructHUB's carrier account.
                    </p>
                  )}
                </div>
              )}

              {senderForm.mode === "byo" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="sms-space">SignalWire space URL</Label>
                    <Input id="sms-space" placeholder="yourcompany.signalwire.com"
                      value={senderForm.spaceUrl}
                      onChange={(e) => setSenderForm((f) => ({ ...f, spaceUrl: e.target.value }))}
                      data-testid="input-sms-space" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sms-project">Project ID</Label>
                    <Input id="sms-project" value={senderForm.projectId}
                      onChange={(e) => setSenderForm((f) => ({ ...f, projectId: e.target.value }))}
                      data-testid="input-sms-project" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="sms-token">API token</Label>
                    <Input id="sms-token" type="password" placeholder="leave blank to keep the saved token"
                      value={senderForm.apiToken}
                      onChange={(e) => setSenderForm((f) => ({ ...f, apiToken: e.target.value }))}
                      data-testid="input-sms-token" />
                    <p className="text-xs text-muted-foreground">
                      Stored encrypted and never shown again. Your texts bill to your own SignalWire account.
                    </p>
                  </div>
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
            </div>
            <Switch
              checked={(org?.customFields as any)?.smsEstimates === true}
              onCheckedChange={(v) => saveSmsEstimates.mutate(v)}
              disabled={saveSmsEstimates.isPending || !smsStatus?.configured}
              data-testid="switch-sms-estimates"
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
              data-testid="switch-sms-alerts"
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
                onCheckedChange={(v) => saveLock.mutate({ enabled: v, floorBps: lockBps() })}
                disabled={saveLock.isPending}
                data-testid="switch-price-lock"
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
                onClick={() => saveLock.mutate({ enabled: priceFloorLock.enabled === true, floorBps: lockBps() })}
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
              title="Auto-backup"
              description="Your whole book of business — clients, estimates and invoices — emailed to you every week or two."
              infoKey="backups"
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Automatic email backups</div>
                <div className="text-xs text-muted-foreground">
                  When a backup comes due it's generated and emailed automatically (checked every 15 minutes).
                </div>
              </div>
              <Switch
                checked={backupForm.enabled}
                onCheckedChange={(v) => setBackupForm((f) => ({ ...f, enabled: v }))}
                data-testid="switch-backup-enabled"
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>Frequency</Label>
                <Select value={backupForm.frequency}
                  onValueChange={(v) => setBackupForm((f) => ({ ...f, frequency: v as typeof f.frequency }))}>
                  <SelectTrigger className="w-44" data-testid="select-backup-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Every week</SelectItem>
                    <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Format</Label>
                <Select value={backupForm.format}
                  onValueChange={(v) => setBackupForm((f) => ({ ...f, format: v as typeof f.format }))}>
                  <SelectTrigger className="w-56" data-testid="select-backup-format">
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
                  data-testid="input-backup-email" placeholder="you@company.com"
                  value={backupForm.email}
                  onChange={(e) => setBackupForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <Button onClick={() => saveBackup.mutate()}
                disabled={saveBackup.isPending || !backupForm.email.trim()}
                data-testid="button-save-backup">
                {saveBackup.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save backup settings
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button variant="outline" onClick={() => sendBackupNow.mutate()}
                disabled={sendBackupNow.isPending}
                data-testid="button-send-backup-now">
                {sendBackupNow.isPending
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <DatabaseBackup className="h-4 w-4 mr-2" />}
                Send backup now
              </Button>
              <div className="text-xs text-muted-foreground" data-testid="text-backup-last-sent">
                {backupCfg.lastSentAt
                  ? `Last sent ${new Date(backupCfg.lastSentAt).toLocaleString()}`
                  : "Never sent yet"}
              </div>
            </div>
            {backupCfg.lastError && (
              <p className="text-xs text-destructive" data-testid="text-backup-error">
                Last backup failed: {backupCfg.lastError}
              </p>
            )}
          </CardContent>
        </Card>
      )}

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
                <Label>Allowed methods</Label>
                <Select value={feeForm.railMode}
                  onValueChange={(v) => setFeeForm((f) => ({ ...f, railMode: v as typeof f.railMode }))}>
                  <SelectTrigger className="w-64" data-testid="select-rail-mode">
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
                  Card checkouts add a clearly-labelled "Card processing fee" line. Bank transfer (ACH) is always fee-free.
                </p>
              </div>
              <Switch
                checked={feeForm.passFeeToClient}
                onCheckedChange={(v) => setFeeForm((f) => ({ ...f, passFeeToClient: v }))}
                data-testid="switch-pass-fee"
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
                        disabled={savePaySettings.isPending} data-testid={`button-remove-financing-${i}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {finLinks.length < 10 && (
              <div className="flex flex-wrap gap-2">
                <Input placeholder="Label (e.g. GreenSky financing)" className="sm:w-56"
                  data-testid="input-financing-label"
                  value={newLink.label} onChange={(e) => setNewLink((n) => ({ ...n, label: e.target.value }))} />
                <Input placeholder="https://…" className="flex-1 min-w-48"
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
          {calendarParam === "connected=1" && (
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
                onClick={() => {
                  if (calFeed?.url) navigator.clipboard?.writeText(calFeed.url).catch(() => {});
                  toast({ title: "Copied" });
                }}>
                <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
              </Button>
              <Button size="sm" variant="outline" className="shrink-0" data-testid="button-regenerate-calendar-feed"
                onClick={() => rotateFeed.mutate()} disabled={rotateFeed.isPending}>
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
                <div className="text-sm font-medium">Not configured on this server</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Missing environment {(gcalStatus.missing ?? []).length === 1 ? "variable" : "variables"}:{" "}
                  <code>{(gcalStatus.missing ?? []).join(", ")}</code>. Add {(gcalStatus.missing ?? []).length === 1 ? "it" : "them"} to
                  the server <code>.env</code> and restart — the same Google OAuth client the sign-in flow uses,
                  with the <code>calendar.events</code> scope authorized.
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
            description="Where your clients come from. Set per client on the client's page."
          />
        </CardHeader>
        <CardContent>
          {!leadSources?.length ? (
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
