/**
 * /developers — the public API reference, rendered from GET /api/v1/openapi.json
 * (assembled on the server from each resource's OpenAPI fragment). The parts
 * that never change — how to authenticate, the limits, what the API will not
 * do — are written here so the page is useful even before the reference is
 * published, and it says so honestly when the document isn't there.
 *
 * A documented read or write is achievable from this page alone: every
 * operation shows its scope and cost, its parameters, the full request and
 * response schemas (nested objects and arrays included), an example body and
 * response generated from those schemas, and a curl line for its method. Every
 * endpoint has a stable anchor (#get-locations-id), and the list is searchable.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiErrorMessage } from "@/lib/queryClient";
import { inNativeApp } from "@/lib/app-shell";
import { PLANS, PLAN_KEYS, UNLIMITED, type PlanKey } from "@shared/plans";
import { joinNames } from "@shared/plan-copy";
import { Check, KeyRound, Link as LinkIcon, Search, ShieldAlert } from "lucide-react";
import { API_NO_AI_NOTICE } from "@/pages/settings/api/api-keys-panel";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { HelpButton } from "@/components/help-button";
import { BTN_PRIMARY, Kicker } from "@/components/feature-landing/primitives";
import { copyToClipboard } from "@/pages/settings/billing/format";
import { SITE_ORIGIN } from "@shared/seo";

// ── The slice of OpenAPI 3 this page reads ──────────────────────────────────
type Schema = {
  type?: string; format?: string; description?: string; enum?: unknown[]; items?: Schema;
  properties?: Record<string, Schema>; required?: string[]; nullable?: boolean; $ref?: string; example?: unknown;
  default?: unknown; additionalProperties?: Schema | boolean; minimum?: number; maximum?: number; maxLength?: number;
  minItems?: number; maxItems?: number;
};
type Parameter = { name: string; in: "query" | "path" | "header" | "cookie" | string; required?: boolean; description?: string; schema?: Schema };
type MediaTypes = Record<string, { schema?: Schema }>;
type Operation = {
  summary?: string; description?: string; tags?: string[]; operationId?: string; deprecated?: boolean;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; description?: string; content?: MediaTypes };
  responses?: Record<string, { description?: string; content?: MediaTypes }>;
  "x-units"?: number | string; "x-scope"?: string; "x-ai"?: string;
};
type OpenApiDoc = {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: { url: string; description?: string }[];
  tags?: { name: string; description?: string }[];
  paths?: Record<string, Record<string, Operation | unknown>>;
  components?: { schemas?: Record<string, Schema>; securitySchemes?: Record<string, { type?: string; scheme?: string; description?: string }> };
  "x-limits"?: { units?: { read?: string; write?: number } };
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
type Method = (typeof METHODS)[number];
const METHOD_CLASS: Record<Method, string> = {
  get: "bg-emerald-600 text-white", post: "bg-blue-600 text-white", put: "bg-amber-600 text-white", patch: "bg-amber-600 text-white", delete: "bg-red-600 text-white",
};
/** What the metering middleware charges (server/public-api/quota.ts); the document's own values win when present. */
const READ_COST = "1 + 1 per 100 rows";
const WRITE_COST = 5;

type Endpoint = { method: Method; path: string; op: Operation; tag: string; id: string };

/** "#get-locations-id": the anchor of an endpoint, stable across renders and shareable. */
export function endpointId(method: string, path: string): string {
  return `${method}-${path}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function flatten(doc: OpenApiDoc | undefined): Endpoint[] {
  const out: Endpoint[] = [];
  for (const [path, item] of Object.entries(doc?.paths ?? {})) {
    for (const method of METHODS) {
      const op = (item as Record<string, Operation | undefined>)[method];
      if (!op || typeof op !== "object") continue;
      out.push({ method, path, op, tag: op.tags?.[0] ?? "Other", id: endpointId(method, path) });
    }
  }
  return out;
}

/** The scope the middleware checks: the document's x-scope, else read for GET and write for everything else. */
export const scopeOf = (e: Pick<Endpoint, "method" | "op">): string => (e.op["x-scope"] ? String(e.op["x-scope"]) : e.method === "get" ? "read" : "write");
/** "1 unit + 1 per 100 rows" / "5 units": the document's x-units, else the metering rule for the method. */
export function costOf(e: Pick<Endpoint, "method" | "op">, doc?: OpenApiDoc): string {
  const raw = e.op["x-units"] ?? (e.method === "get" ? doc?.["x-limits"]?.units?.read ?? READ_COST : doc?.["x-limits"]?.units?.write ?? WRITE_COST);
  if (typeof raw === "number") return `${raw} unit${raw === 1 ? "" : "s"}`;
  const s = String(raw);
  return /^\d+\s*\+/.test(s) ? s.replace(/^(\d+)/, (n) => `${n} unit${n === "1" ? "" : "s"}`) : s;
}

function refName(s: Schema | undefined): string | null {
  return s?.$ref ? (s.$ref.split("/").pop() ?? null) : null;
}

function resolve(s: Schema | undefined, doc: OpenApiDoc | undefined): Schema | undefined {
  if (!s?.$ref) return s;
  return doc?.components?.schemas?.[refName(s) ?? ""];
}

/** "integer", "array of string", "object", "map of string", or the referenced schema's name. */
function schemaType(s: Schema | undefined, doc: OpenApiDoc | undefined): string {
  if (!s) return "";
  const name = refName(s);
  if (name) return name;
  if (s.type === "array") return `array of ${schemaType(s.items, doc) || "object"}`;
  if (s.enum) return s.enum.map(String).join(" | ");
  if (s.type === "object" && s.additionalProperties && typeof s.additionalProperties === "object" && !s.properties) return `map of ${schemaType(s.additionalProperties, doc) || "any"}`;
  return `${s.type ?? "object"}${s.format ? ` (${s.format})` : ""}${s.nullable ? ", nullable" : ""}`;
}

/** Constraints worth a reader's eye: "max 1500 chars", "1–20 items", "default STANDARD". */
function constraints(s: Schema): string[] {
  const out: string[] = [];
  if (s.maxLength !== undefined) out.push(`max ${s.maxLength.toLocaleString("en-US")} chars`);
  if (s.minimum !== undefined || s.maximum !== undefined) out.push(`${s.minimum ?? ""}–${s.maximum ?? ""}`.replace(/^–/, "up to ").replace(/–$/, " or more"));
  if (s.minItems !== undefined || s.maxItems !== undefined) out.push(`${s.minItems ?? 0}–${s.maxItems ?? ""} items`.replace(/–\s*items/, " or more items"));
  if (s.default !== undefined) out.push(`default ${JSON.stringify(s.default)}`);
  return out;
}

/**
 * An example value built from a schema, so every request body and response has one to copy.
 * Values come from the schema itself (example, default, the first enum value) or are typed
 * placeholders by type/format; nothing here is real account data, and the page says so.
 */
export function gbpPostExamples(now = new Date()) {
  const publish = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const start = new Date(publish.getTime() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const common = { text: "Example update for your business", scheduledAt: publish.toISOString() };
  const event = { title: "Example open house", start: start.toISOString().slice(0, 16), end: end.toISOString().slice(0, 16) };
  return {
    STANDARD: { ...common, topicType: "STANDARD", callToAction: { actionType: "LEARN_MORE", url: "https://example.com/details" } },
    EVENT: { ...common, topicType: "EVENT", event, callToAction: { actionType: "CALL" } },
    OFFER: { ...common, topicType: "OFFER", event: { ...event, title: "Example seasonal offer" }, offer: { couponCode: "EXAMPLE", redeemOnlineUrl: "https://example.com/offer", termsConditions: "Replace with your offer terms." } },
  };
}

export function exampleFor(s: Schema | undefined, doc: OpenApiDoc | undefined, seen: Set<string> = new Set(), depth = 0, now = new Date()): unknown {
  if (!s || depth > 8) return null;
  const name = refName(s);
  if (name === "GbpPostInput") return gbpPostExamples(now).STANDARD;
  if (name) {
    if (seen.has(name)) return {}; // a self-referencing schema stops here
    const target = doc?.components?.schemas?.[name];
    return exampleFor(target, doc, new Set([...seen, name]), depth + 1, now);
  }
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined && s.type !== "object" && s.type !== "array") return s.default;
  if (s.enum?.length) return s.enum[0];
  switch (s.type) {
    case "integer": return s.minimum !== undefined ? s.minimum : 1;
    case "number": return s.minimum !== undefined ? s.minimum : 1.5;
    case "boolean": return true;
    case "array": return [exampleFor(s.items, doc, seen, depth + 1, now)];
    case "string":
      switch (s.format) {
        case "uuid": return crypto.randomUUID();
        case "date-time": return new Date(now.getTime() + 3 * 86_400_000).toISOString();
        case "date": return new Date(now.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
        case "local-date-time": return new Date(now.getTime() + 3 * 86_400_000).toISOString().slice(0, 16);
        case "uri": case "url": return "https://example.com/photo.jpg";
        case "email": return "name@example.com";
        default: return "string";
      }
    case "object":
    default: {
      if (s.properties) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(s.properties)) out[k] = exampleFor(v, doc, seen, depth + 1, now);
        return out;
      }
      if (s.additionalProperties && typeof s.additionalProperties === "object") return { key: exampleFor(s.additionalProperties, doc, seen, depth + 1, now) };
      return s.type === "object" || !s.type ? {} : null;
    }
  }
}

/** Minimal inputs for the write contracts, with optional settings kept below. */
export function minimalWriteExample(schema: Schema | undefined, doc?: OpenApiDoc): unknown {
  switch (refName(schema)) {
    case 'SocialPostInput': return {
      businessId: 123, requestId: crypto.randomUUID(), text: 'An update from our team.',
      destinations: [{ accountId: 'YOUR_CONNECTED_ACCOUNT_ID', platform: 'twitter' }],
    };
    case 'GbpPostInput': return { requestKey: crypto.randomUUID(), text: 'An update from our team.' };
    case 'GbpReplyInput': return { text: 'Thank you for sharing your feedback.' };
    case 'SiteScanInput': return { url: 'https://example.com' };
    default: {
      const s = resolve(schema, doc);
      if (!s?.properties) return exampleFor(s, doc);
      return Object.fromEntries((s.required ?? []).map(key => [key, exampleFor(s.properties![key], doc)]));
    }
  }
}

/** Monthly API units per plan, when the price book carries them. */
function planUnits(): { key: PlanKey; name: string; units: number }[] | null {
  const rows = PLAN_KEYS.map((k) => {
    const units = (PLANS[k].limits as Partial<Record<"apiUnitsPerMonth", number>>).apiUnitsPerMonth;
    return typeof units === "number" ? { key: k, name: PLANS[k].name, units } : null;
  });
  return rows.every((r) => r !== null) ? (rows as { key: PlanKey; name: string; units: number }[]) : null;
}

/** "Unlimited (fair use)", "50,000" or "No API access": the plan model's convention, -1 means no cap. */
export function unitsLabel(units: number): string {
  if (units === UNLIMITED) return "Unlimited (fair use)";
  return units > 0 ? units.toLocaleString("en-US") : "No API access";
}

/**
 * Requests per minute per key, from the price book and grouped by rate — the plans with the API
 * don't all share one ("60 on Pro and Agency, 120 on Unlimited"; server/public-api/rate-limit.ts
 * enforces each plan's apiRatePerMinute).
 */
export function rateLimitLine(): string {
  const byRate = new Map<number, string[]>();
  for (const k of PLAN_KEYS) {
    const plan = PLANS[k];
    if (plan.limits.apiUnitsPerMonth === 0) continue;
    byRate.set(plan.limits.apiRatePerMinute, [...(byRate.get(plan.limits.apiRatePerMinute) ?? []), plan.name]);
  }
  const groups = [...byRate.entries()].sort((a, b) => a[0] - b[0]);
  if (groups.length <= 1) return `${groups[0]?.[0] ?? 60} requests per minute per key`;
  return groups.map(([rate, names], i) => (i === 0 ? `${rate} requests per minute per key on ${joinNames(names)}` : `${rate} on ${joinNames(names)}`)).join(", ");
}

/**
 * A server without the public API answers /api/v1/openapi.json with the SPA's
 * HTML (200) rather than JSON; that is "not published", not a parse error.
 */
async function fetchOpenApi(): Promise<OpenApiDoc> {
  const res = await fetch("/api/v1/openapi.json", { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  if (!/\bjson\b/i.test(res.headers.get("content-type") ?? "")) throw new Error("404: no OpenAPI document at /api/v1/openapi.json");
  const doc = (await res.json()) as OpenApiDoc;
  if (!doc || typeof doc !== "object" || !doc.paths) throw new Error("404: no OpenAPI document at /api/v1/openapi.json");
  return doc;
}

/** The endpoints a search matches: method, path, summary, operationId or resource, case-insensitive, every word. */
export function matchesSearch(e: Pick<Endpoint, "method" | "path" | "op" | "tag">, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${e.method} ${e.path} ${e.op.summary ?? ""} ${e.op.operationId ?? ""} ${e.tag}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

const tagKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
const prettyTag = (t: string) => t.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const tagAnchor = (t: string) => `resource-${t.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export default function DevelopersPage() {
  const { data: doc, isLoading, error, refetch, isFetching } = useQuery<OpenApiDoc>({ queryKey: ["/api/v1/openapi.json"], queryFn: fetchOpenApi });
  const endpoints = useMemo(() => flatten(doc), [doc]);
  // One card per resource: the document mixes spellings of the same tag
  // ("account"/"Account", "locations"/"Locations", "social-posts"/"Social posts",
  // "site-scans"/"Site scans"), which used to render near-duplicate sections and
  // split reads from their write operations. Group on a normalized key.
  const tags = useMemo(() => {
    const groups = new Map<string, string>();
    for (const t of doc?.tags ?? []) {
      const k = tagKey(t.name);
      // Prefer a display name with real capitalization ("Account", not "account").
      if (!groups.has(k) || (!/[A-Z]/.test(groups.get(k)!) && /[A-Z]/.test(t.name))) groups.set(k, t.name);
    }
    for (const e of endpoints) if (!groups.has(tagKey(e.tag))) groups.set(tagKey(e.tag), prettyTag(e.tag));
    return Array.from(groups.values());
  }, [doc, endpoints]);
  const origin = SITE_ORIGIN;
  const base = `${origin}/api/v1`;
  const units = planUnits();
  const [search, setSearch] = useState("");
  const shown = useMemo(() => endpoints.filter((e) => matchesSearch(e, search)), [endpoints, search]);
  // A shared link (#post-locations-id-posts) opens its endpoint and scrolls to it once the reference is in.
  const [hash, setHash] = useState(() => (typeof window !== "undefined" ? window.location.hash.slice(1) : ""));
  useEffect(() => {
    const onHash = () => setHash(window.location.hash.slice(1));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (!hash || !endpoints.length) return;
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ block: "start" });
  }, [hash, endpoints.length]);

  useEffect(() => { document.title = "Developers | ConstructHUB"; }, []);

  return (
    <div className="h-full overflow-y-auto flex flex-col">
      <PublicPageHeader next="/developers" />
      <div className="mkt-editorial mkt-shadcn flex-1 bg-mkt-paper text-mkt-ink overflow-x-clip" data-testid="page-developers">
      <section className="relative">
        <div className="absolute inset-0 mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)]" aria-hidden />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 sm:pt-12 pb-10 sm:pb-12 flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0 max-w-2xl">
            <Kicker n="">Developers</Kicker>
            <h1 className="font-display mt-5 font-semibold text-[2.4rem] sm:text-[3.1rem] lg:text-[3.6rem] leading-[1.04] tracking-[-0.02em] flex flex-wrap items-center gap-2" data-testid="text-developers-title">
              <span>{doc?.info?.title || "ConstructHUB API"}</span>
              {/* The "i" (owner 2026-10-15): what the page is for and how to use it, from the help registry. */}
              <HelpButton k="developers" className="mt-2 self-center" />
            </h1>
            <p className="mt-4 text-base sm:text-lg text-mkt-ink-soft leading-relaxed">
              {doc?.info?.description?.split("\n")[0] || "Read your ConstructHUB data and update your records from your own tools."}
              {doc?.info?.version ? ` Version ${doc.info.version}.` : ""}
            </p>
          </div>
          <Link href="/settings/api" className={`${BTN_PRIMARY} h-11 px-5 text-[15px]`} data-testid="link-developers-keys"><KeyRound className="h-4 w-4" aria-hidden="true" />Manage API keys</Link>
        </div>
        <div className="mkt-ruler" aria-hidden />
      </section>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 space-y-8">

        {/* How this works, in three steps (owner 2026-10-15: a bare reference page explains itself before the detail). */}
        <Card className={CARD} data-testid="card-developers-how">
          <CardHeader>
            <CardTitle className={CARD_TITLE}>How this works</CardTitle>
            <CardDescription>Three steps from nothing to your first call.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-4 sm:grid-cols-3 text-sm" data-testid="list-developers-how">
              {[
                ["Create a key", inNativeApp() ? "Under Settings → API keys. The full key is shown once; copy it then." : "In Settings → API keys. The full key is shown once; copy it then.", inNativeApp() ? null : "/settings/api", "Open API keys"],
                ["Call the API", "Send the key as Authorization: Bearer <key> to the /api/v1 base. Every endpoint below has a curl line and an example body to copy.", "#section-developers-endpoints", "See the endpoints"],
                ["Watch usage", "Settings → API usage shows units and requests per day, by key. A read is 1 unit (+1 per 100 rows); a write is 5.", inNativeApp() ? null : "/settings?tab=api-usage", "Open API usage"],
              ].map(([title, body, href, label], i) => (
                <li key={title as string} className="rounded-xl border border-mkt-rule bg-mkt-card p-4">
                  <p className="font-display font-semibold text-[1.05rem]"><span className="text-mkt-orange-ink mr-2 tabular-nums">{i + 1}</span>{title}</p>
                  <p className="mt-1 text-muted-foreground">{body}</p>
                  {href && (href as string).startsWith("#")
                    ? <a href={href as string} className="mt-2 inline-block underline underline-offset-4" onClick={(e) => { e.preventDefault(); document.querySelector('[data-testid="section-developers-endpoints"]')?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{label}</a>
                    : href ? <Link href={href as string} className="mt-2 inline-block underline underline-offset-4">{label}</Link> : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Alert className="rounded-2xl border-mkt-orange bg-mkt-card [&>svg]:text-mkt-orange-ink" data-testid="banner-developers-no-ai">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          <AlertTitle level={2} className="font-display font-semibold text-[1.15rem]">What the API doesn't do</AlertTitle>
          <AlertDescription>
            <span data-testid="text-developers-no-ai">{API_NO_AI_NOTICE}</span>{" "}
            Posts, review replies and social posts you create through the API are stored exactly as you send them (source: api) and
            no AI rewrites them. AI settings can't be read or changed through the API. Use your own scripts or your own AI to write
            content, then send it here on your own schedule.
          </AlertDescription>
        </Alert>

        <Card className={CARD} data-testid="card-developers-auth">
          <CardHeader>
            <CardTitle className={CARD_TITLE}>Authentication</CardTitle>
            <CardDescription>Every request carries an API key from Settings → API keys as a bearer token. A key reads and writes only the account it belongs to.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="grid grid-cols-1 sm:grid-cols-[9rem_1fr] gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">Base URL</dt>
              <dd><code className="break-all" data-testid="text-developers-base-url">{base}</code></dd>
              <dt className="text-muted-foreground">Header</dt>
              <dd><code className="break-all">Authorization: Bearer chub_&lt;prefix&gt;_&lt;secret&gt;</code></dd>
              <dt className="text-muted-foreground">Scopes</dt>
              <dd><Badge variant="secondary" className="mr-1">read</Badge> lists and exports (every GET) · <Badge variant="secondary" className="mr-1">write</Badge> creates and updates records (every POST)</dd>
              <dt className="text-muted-foreground">Errors</dt>
              <dd>One shape on every status: <code>{`{ "error": { "code", "message", ... } }`}</code> — check <code>code</code> in your script.</dd>
            </dl>
            <pre className="rounded-xl bg-mkt-navy text-mkt-navy-ink p-4 text-xs overflow-x-auto" data-testid="text-developers-curl">
{`curl ${base}/openapi.json \\
  -H "Authorization: Bearer chub_abc123_YOUR_SECRET"`}
            </pre>
            <p className="text-xs text-muted-foreground">
              An API key never signs in to the app itself; it works only under <code>/api/v1</code>. Revoke a key the moment it may have leaked.
            </p>
          </CardContent>
        </Card>

        <Card className={CARD} data-testid="card-developers-limits">
          <CardHeader>
            <CardTitle className={CARD_TITLE}>Limits and units</CardTitle>
            {/* The iPhone apps sell nothing (App Store 3.1.3(f)): no "on a plan" wording there. */}
            <CardDescription>{inNativeApp() ? "Fair, predictable and the same for every account." : "Fair, predictable and the same for everyone on a plan."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Rate limit:</strong> <span data-testid="text-developers-rate">{inNativeApp() ? "your account's requests per minute per key" : rateLimitLine()}</span>, with a cap per account across all its keys. Over it, <code>429 rate_limited</code> with a <code>Retry-After</code> header.</li>
              <li><strong>Units:</strong> a read costs 1 unit plus 1 per 100 rows returned; a write costs 5 units. Only successful responses count.</li>
              <li><strong>Monthly quota:</strong> {inNativeApp() ? <>your account's units, and optionally a lower cap per key. When it's used up: <code>429 quota_exceeded</code>. An account without API access: <code>402 plan_required</code>.</> : <>your plan's units, and optionally a lower cap per key. When it's used up: <code>429 quota_exceeded</code>. A plan without API access: <code>402 plan_required</code>.</>} Units reset on the 1st of each month (UTC).</li>
              <li><strong>Headers on every response:</strong> <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>, <code>X-Units-Remaining</code>.</li>
            </ul>
            {/* The iPhone apps sell nothing (App Store 3.1.3(f)): the per-plan units table names the
                plan tiers — hidden there; the app shows only the account's own usage in Settings. */}
            {units && !inNativeApp() && (
              <table className="w-full text-sm" data-testid="table-developers-plan-units">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">Plan</th><th className="py-1 font-medium text-right whitespace-nowrap">Units / month</th><th className="py-1 font-medium text-right whitespace-nowrap">Requests / min per key</th></tr></thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.key} className="border-t" data-testid={`row-plan-units-${u.key}`}>
                      <td className="py-1">{u.name}</td>
                      <td className="py-1 text-right tabular-nums">{unitsLabel(u.units)}</td>
                      <td className="py-1 text-right tabular-nums">{u.units === 0 ? "—" : PLANS[u.key].limits.apiRatePerMinute}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(!units || inNativeApp()) && (
              <p className="text-xs text-muted-foreground" data-testid="text-developers-plan-units">
                {inNativeApp() ? "Your monthly units are listed with your API keys." : "Your plan's monthly units are shown in Settings → API keys."}
              </p>
            )}
          </CardContent>
        </Card>

        <section className="space-y-4" data-testid="section-developers-endpoints">
          <div>
            <Kicker n="">Reference</Kicker>
            <h2 className="font-display font-semibold text-[2rem] leading-tight mt-3">Endpoints</h2>
            <p className="text-sm text-muted-foreground">
              Generated from <a href="/api/v1/openapi.json" className="underline underline-offset-4" data-testid="link-developers-openapi">/api/v1/openapi.json</a>, which is also what an API client or your own AI can read.
              Examples are built from the schemas, not from any account's data.
            </p>
          </div>
          {isLoading ? (
            <div className="space-y-3" aria-busy="true"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
          ) : error ? (
            <Card className={CARD}><CardContent className="pt-6 text-sm text-muted-foreground flex flex-wrap items-center justify-between gap-3" data-testid="text-developers-unpublished">
              <span>The API reference isn't published on this server yet ({apiErrorMessage(error, "no response")}). The authentication, limits and AI rules above still apply.</span>
              <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching} data-testid="button-developers-retry">Try again</Button>
            </CardContent></Card>
          ) : endpoints.length === 0 ? (
            <Card className={CARD}><CardContent className="pt-6 text-sm text-muted-foreground" data-testid="text-developers-unpublished">The API reference lists no endpoints yet.</CardContent></Card>
          ) : (
            <>
              {/* The index: one chip per resource with its endpoint count, and a search over method, path and summary. */}
              <nav aria-label="API resources" className="flex flex-wrap gap-2" data-testid="nav-developers-resources">
                {tags.map((tag) => {
                  const n = endpoints.filter((e) => tagKey(e.tag) === tagKey(tag)).length;
                  return (
                    <a key={tag} href={`#${tagAnchor(tag)}`} className="inline-flex items-center gap-1.5 rounded-full border border-mkt-rule bg-mkt-card px-3 py-1 text-xs font-medium hover:border-mkt-orange focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange" data-testid={`link-developers-resource-${tagAnchor(tag)}`}>
                      {tag} <span className="text-muted-foreground tabular-nums">{n}</span>
                    </a>
                  );
                })}
              </nav>
              <div className="relative max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search endpoints: reviews, post, /locations/{id}…"
                  aria-label="Search endpoints"
                  className="!pl-10"
                  data-testid="input-developers-search"
                />
              </div>
              <p className="text-xs text-muted-foreground" data-testid="text-developers-count">
                {search ? `${shown.length} of ${endpoints.length} endpoints match` : `${endpoints.length} endpoints across ${tags.length} resources`}
              </p>
              {shown.length === 0 ? (
                <Card className={CARD}><CardContent className="pt-6 text-sm text-muted-foreground" data-testid="text-developers-no-match">
                  No endpoint matches “{search}”. Try a resource name (reviews, locations), a method (post) or part of a path.
                </CardContent></Card>
              ) : (
                tags.map((tag) => {
                  const rows = shown.filter((e) => tagKey(e.tag) === tagKey(tag));
                  if (!rows.length) return null;
                  return (
                    <Card key={tag} id={tagAnchor(tag)} className={`${CARD} scroll-mt-24`} data-testid={`card-developers-tag-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                      <CardHeader>
                        <CardTitle className={CARD_TITLE}>{tag}</CardTitle>
                        {doc?.tags?.find((t) => t.name === tag)?.description && <CardDescription>{doc.tags.find((t) => t.name === tag)!.description}</CardDescription>}
                      </CardHeader>
                      <CardContent className="divide-y">
                        {rows.map((e) => <EndpointRow key={e.id} e={e} doc={doc} base={base} open={hash === e.id} />)}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </>
          )}
        </section>

        <Card className={CARD} data-testid="card-developers-crm">
          <CardHeader>
            <CardTitle className={CARD_TITLE}>CRM API</CardTitle>
            <CardDescription>The CRM has its own keys (<code>chk_…</code>, created in the portal under Integrations) for its customers, projects, estimates, invoices and payments.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Both key types share the <code>/api/v1</code> base and the bearer header. The CRM's index is at <a href="/api/v1" className="underline underline-offset-4">/api/v1</a>; its webhooks are signed with <code>ConstructHUB-Signature</code>.
          </CardContent>
        </Card>
      </div>
      </div>
      <PublicPageFooter />
    </div>
  );
}

const CARD = "rounded-2xl border-mkt-rule bg-mkt-card shadow-none";
const CARD_TITLE = "font-display font-semibold text-[1.35rem] leading-tight";

/** A curl line for the operation: GET as is; a write with the JSON example as its body. Path parameters stay as {id} to fill in. */
export function curlFor(e: Pick<Endpoint, "method" | "path" | "op">, doc: OpenApiDoc | undefined, base: string, example?: unknown): string {
  const relative = e.path.replace(/^\/api\/v1/, "");
  const auth = `-H "Authorization: Bearer chub_abc123_YOUR_SECRET"`;
  if (e.method === "get") return `curl "${base}${relative}" ${auth}`;
  const schema = e.op.requestBody?.content?.["application/json"]?.schema;
  const body = schema ? JSON.stringify(example ?? exampleFor(schema, doc), null, 2) : null;
  return `curl -X ${e.method.toUpperCase()} "${base}${relative}" \\\n  ${auth} \\\n  -H "Content-Type: application/json"${body ? ` \\\n  -d '${body.replace(/'/g, "'\\''")}'` : ""}`;
}

function EndpointRow({ e, doc, base, open }: { e: Endpoint; doc: OpenApiDoc | undefined; base: string; open: boolean }) {
  const body = e.op.requestBody?.content?.["application/json"]?.schema;
  const bodySchema = resolve(body, doc);
  // Stable for this mounted example, including copying and expanding schemas.
  const [minimal] = useState(() => minimalWriteExample(body, doc));
  const [fullExample] = useState(() => exampleFor(body, doc));
  const [gbpExamples] = useState(() => Object.fromEntries(Object.entries(gbpPostExamples()).map(
    ([topic, value]) => [topic, { ...value, requestKey: crypto.randomUUID() }],
  )));
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${e.id}`;
    const ok = await copyToClipboard(url);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1500);
  };
  const scope = scopeOf(e);
  const cost = costOf(e, doc);
  const pathParams = (e.op.parameters ?? []).filter((p) => p.in === "path");
  const responses = Object.entries(e.op.responses ?? {});
  const okResponses = responses.filter(([code]) => /^2/.test(code));
  return (
    <details className="py-3 group scroll-mt-24" id={e.id} open={open || undefined} data-testid={`endpoint-${e.id}`}>
      <summary className="flex flex-wrap items-center gap-2 cursor-pointer list-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange">
        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${METHOD_CLASS[e.method]}`}>{e.method}</span>
        <code className="text-sm break-all">{e.path}</code>
        <Badge variant="outline" className="text-[10px]" data-testid={`badge-scope-${e.id}`}>{scope}</Badge>
        <Badge variant="secondary" className="text-[10px] tabular-nums" data-testid={`badge-cost-${e.id}`}>{cost}</Badge>
        {e.op.deprecated && <Badge variant="destructive" className="text-[10px]">Deprecated</Badge>}
        {e.op.summary && <span className="text-sm text-muted-foreground basis-full sm:basis-auto">{e.op.summary}</span>}
      </summary>
      <div className="mt-3 space-y-4 text-sm">
        {e.method !== 'get' && <div>
          <p className="font-medium mb-1">Minimal example request</p>
          <p className="text-muted-foreground mb-2">Illustrative values: replace IDs, text and URLs with your own before sending. Find your business ID in Social Media after opening a business: the number in <code className="break-all">?business=123</code>, or the <code>id</code> returned by <code>GET /locations</code>. Replace path placeholders with the location or review ID from the corresponding read endpoint.</p>
          {refName(body) === 'SocialPostInput' && <p className="text-muted-foreground mb-2">Use an account ID and platform mapped to that business in Social Media settings. This text-only example uses Twitter; other networks may require media or a page/board ID. Omitting scheduling queues the post for the next worker run.</p>}
          {['SocialPostInput', 'GbpPostInput'].includes(refName(body) ?? '') && <p className="text-muted-foreground mb-2">This example has a fresh idempotency key. Retries must reuse the same key and identical payload. Generate a new UUID for each new operation; do not reuse a key after editing the content. The key stays unchanged while this example is open.</p>}
          <pre className="max-w-full rounded-xl bg-mkt-navy text-mkt-navy-ink p-4 text-xs overflow-x-auto" data-testid={`example-minimal-${e.id}`}>{curlFor(e, doc, base, minimal)}</pre>
        </div>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Scope: <code>{scope}</code> · Cost: {cost}</span>
          <a href={`#${e.id}`} className="inline-flex items-center gap-1 underline underline-offset-4" data-testid={`link-endpoint-${e.id}`}><LinkIcon className="h-3 w-3" aria-hidden="true" />#{e.id}</a>
          <button type="button" onClick={() => void copyLink()} className="inline-flex items-center gap-1 underline underline-offset-4" data-testid={`button-copy-endpoint-${e.id}`}>
            {copied ? <><Check className="h-3 w-3" aria-hidden="true" />Copied</> : "Copy link"}
          </button>
        </div>
        {e.op.description && <p className="text-muted-foreground whitespace-pre-line">{e.op.description}</p>}
        {e.op["x-ai"] && <p className="text-xs text-muted-foreground">AI: {String(e.op["x-ai"])}</p>}
        {!!e.op.parameters?.length && (
          <div>
            <p className="font-medium mb-1">Parameters</p>
            <ul className="space-y-1">
              {e.op.parameters.map((p) => (
                <li key={`${p.in}-${p.name}`} className="flex flex-wrap gap-x-2">
                  <code className="break-all">{p.name}</code>
                  <span className="text-xs text-muted-foreground">{p.in}{p.required ? ", required" : ""}{p.schema ? ` · ${schemaType(p.schema, doc)}` : ""}{p.schema ? constraints(p.schema).map((c) => ` · ${c}`).join("") : ""}</span>
                  {p.description && <span className="text-muted-foreground basis-full">{p.description}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {bodySchema && (
          <div>
            <p className="font-medium mb-1">Request body <span className="text-xs text-muted-foreground font-normal">application/json{e.op.requestBody?.required ? ", required" : ""}{refName(body) ? ` · ${refName(body)}` : ""}</span></p>
            {e.op.requestBody?.description && <p className="text-xs text-muted-foreground mb-1">{e.op.requestBody.description}</p>}
            <SchemaTree schema={bodySchema} doc={doc} testId={`schema-request-${e.id}`} />
          </div>
        )}
        {responses.length > 0 && (
          <div>
            <p className="font-medium mb-1">Responses</p>
            <ul className="space-y-1">
              {responses.map(([code, r]) => {
                const rs = r?.content?.["application/json"]?.schema;
                const resolved = resolve(rs, doc);
                return (
                  <li key={code} className="text-muted-foreground">
                    <code>{code}</code>{r?.description ? ` — ${r.description}` : ""}
                    {resolved && (
                      <details className="mt-1 ml-4">
                        <summary className="cursor-pointer text-xs underline underline-offset-4" data-testid={`summary-response-${e.id}-${code}`}>Schema{refName(rs) ? ` · ${refName(rs)}` : ""}</summary>
                        <SchemaTree schema={resolved} doc={doc} testId={`schema-response-${e.id}-${code}`} />
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <details>
          <summary className="font-medium mb-1 cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-mkt-orange">{e.method === 'get' ? 'Example request' : 'Optional fields and scheduling examples'}{pathParams.length ? <span className="text-xs text-muted-foreground font-normal"> · replace {pathParams.map((p) => `{${p.name}}`).join(", ")}</span> : null}</summary>
          {refName(body) === "GbpPostInput" ? <>
            <p className="text-sm text-muted-foreground mb-2">Illustrative payloads: publish time is three days from now. Replace the text, URLs and local event times for your business. EVENT and OFFER require a title and an end after the start. A CTA needs an HTTPS URL except CALL; OFFER uses its redemption URL instead of a CTA.</p>
            {Object.entries(gbpExamples).map(([topic, example]) => <div key={topic} className="mb-3">
              <p className="font-medium mb-1">{topic}</p>
              <pre className="rounded-xl bg-mkt-navy text-mkt-navy-ink p-4 text-xs overflow-x-auto" data-testid={`example-request-${e.id}-${topic}`}>{curlFor(e, doc, base, example)}</pre>
            </div>)}
          </> : <><p className="text-muted-foreground mb-2">Full schema illustration. Optional fields depend on your network and settings; start with the minimal request above for writes.</p><pre className="rounded-xl bg-mkt-navy text-mkt-navy-ink p-4 text-xs overflow-x-auto" data-testid={`example-request-${e.id}`}>{curlFor(e, doc, base, fullExample)}</pre></>}
        </details>
        {okResponses.length > 0 && okResponses[0][1]?.content?.["application/json"]?.schema && (
          <div>
            <p className="font-medium mb-1">Example response <span className="text-xs text-muted-foreground font-normal">{okResponses[0][0]} · shape only, generated from the schema</span></p>
            <pre className="rounded-xl bg-mkt-navy text-mkt-navy-ink p-4 text-xs overflow-x-auto" data-testid={`example-response-${e.id}`}>{JSON.stringify(exampleFor(okResponses[0][1].content!["application/json"].schema, doc), null, 2)}</pre>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * A schema as a nested list: every property with its type, constraints and description; objects
 * and arrays of objects open one level deeper (recursively, cycle-safe), so a nested body such as
 * a social destination or a call-to-action is readable without the raw document.
 */
function SchemaTree({ schema, doc, depth = 0, seen = new Set<string>(), testId }: { schema: Schema; doc: OpenApiDoc | undefined; depth?: number; seen?: Set<string>; testId?: string }) {
  const s = resolve(schema, doc) ?? schema;
  const name = refName(schema);
  const nextSeen = name ? new Set([...seen, name]) : seen;
  if (depth > 6) return <p className="text-xs text-muted-foreground">…</p>;
  if (s.type === "array" && s.items) {
    const item = resolve(s.items, doc);
    const itemName = refName(s.items);
    if (item?.properties && !(itemName && seen.has(itemName))) {
      return (
        <div className={depth ? "ml-4 border-l pl-3" : undefined} data-testid={testId}>
          <p className="text-xs text-muted-foreground">array of {itemName ?? "object"}{constraints(s).map((c) => ` · ${c}`).join("")}, each:</p>
          <SchemaTree schema={item} doc={doc} depth={depth + 1} seen={itemName ? new Set([...nextSeen, itemName]) : nextSeen} />
        </div>
      );
    }
    return <p className={`text-xs text-muted-foreground ${depth ? "ml-4" : ""}`} data-testid={testId}>{schemaType(s, doc)}{constraints(s).map((c) => ` · ${c}`).join("")}</p>;
  }
  if (!s.properties) {
    if (s.additionalProperties && typeof s.additionalProperties === "object") {
      return <p className={`text-xs text-muted-foreground ${depth ? "ml-4" : ""}`} data-testid={testId}>{schemaType(s, doc)}{s.description ? ` — ${s.description}` : ""}</p>;
    }
    return <p className={`text-xs text-muted-foreground ${depth ? "ml-4" : ""}`} data-testid={testId}>{schemaType(s, doc)}{s.description ? ` — ${s.description}` : ""}</p>;
  }
  return (
    <ul className={`space-y-1 ${depth ? "ml-4 border-l pl-3" : ""}`} data-testid={testId}>
      {Object.entries(s.properties).map(([prop, ps]) => {
        const resolved = resolve(ps, doc) ?? ps;
        const childName = refName(ps);
        const itemName = resolved.type === "array" ? refName(resolved.items) : null;
        const cyc = (childName && nextSeen.has(childName)) || (itemName && nextSeen.has(itemName));
        const nested = !cyc && (
          (resolved.properties && Object.keys(resolved.properties).length > 0) ||
          (resolved.type === "array" && !!resolve(resolved.items, doc)?.properties)
        );
        return (
          <li key={prop} className="flex flex-wrap gap-x-2">
            <code className="break-all">{prop}</code>
            <span className="text-xs text-muted-foreground">
              {schemaType(ps, doc)}{s.required?.includes(prop) ? ", required" : ""}{constraints(resolved).map((c) => ` · ${c}`).join("")}
            </span>
            {(ps.description || (childName && resolved.description)) && <span className="text-muted-foreground basis-full">{ps.description ?? resolved.description}</span>}
            {nested && (
              <div className="basis-full">
                <SchemaTree schema={resolved} doc={doc} depth={depth + 1} seen={childName ? new Set([...nextSeen, childName]) : nextSeen} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
