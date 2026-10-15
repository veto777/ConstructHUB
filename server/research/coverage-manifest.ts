/**
 * The coverage manifest behind /compliance/research/coverage: per state, every source the research bot searches,
 * what it holds, how it can be searched and whether it is a daily file or a live search. Generated from the registry
 * (./registry.ts: the original tables, every state pack and ./states/local.ts), never typed in by hand.
 *
 *   - Socrata license datasets: identifiers from their declared fields (business name, person fields or a principals
 *     join, license number, phone, address).
 *   - Live lookups: probed. With every network call stubbed to throw (installNetworkGuard), a search that reaches for
 *     the network for a kind of query really runs that query; one that returns at once without trying doesn't.
 *   - Enforcement datasets: the category their own toHit gives an empty row; live searches and files: their label.
 *   - Daily files: searched by name; what else a file is indexed by is only known from the loaded rows, so
 *     ./coverage.ts coverageFacets() reads that from the database at run time (the page fills it in).
 *
 * Build-time only (script/research-coverage.ts, vite.config.ts): the network guard must never run in the server.
 *   - The original tables' live enforcement and the nationwide records: the source list the report itself writes,
 *     taken from searchStateEnforcement / searchCompanyRecords run under the guard.
 *
 * `blocked` lists stay private: only their count is used, to say plainly when a state has little to search.
 */
import { createRequire, syncBuiltinESMExports } from "node:module";
import type { EnforcementCategory } from "@shared/research-reports";
import { STATE_CODES } from "@shared/research-reports";
import {
  KIND_OF_CATEGORY, COVERAGE_ID_ORDER, COVERAGE_KIND_ORDER,
  type CoverageId, type CoverageKind, type CoverageManifest, type CoverageSource, type CoverageState,
} from "@shared/research-coverage";

import { resetHostState } from "./http";

const require = createRequire(import.meta.url);

// ── The network guard ─────────────────────────────────────────────────────────────────────────────────────────────

class ProbeError extends Error { constructor() { super("coverage probe: network disabled"); } }
let attempts = 0;
let realSetTimeout: typeof setTimeout = setTimeout;
let guarded = false;

/**
 * Stubs every way a search reaches the network (fetch, http/https, net/tls, child processes) so it throws at once,
 * and makes timers fire immediately so rate-limit waits and back-offs don't stall the probes. For the generator's
 * own process only: never call it in the server.
 */
export function installNetworkGuard(): void {
  if (guarded) return;
  guarded = true;
  realSetTimeout = globalThis.setTimeout;
  const deny = () => { attempts++; throw new ProbeError(); };
  globalThis.fetch = (async () => deny()) as typeof fetch;
  for (const mod of ["node:http", "node:https"]) { const m = require(mod); m.request = deny; m.get = deny; }
  for (const mod of ["node:net", "node:tls"]) { const m = require(mod); m.connect = deny; m.createConnection = deny; }
  const cp = require("node:child_process");
  for (const k of ["exec", "execFile", "spawn", "fork", "execSync", "execFileSync", "spawnSync"]) cp[k] = deny;
  syncBuiltinESMExports();
  const fast = ((fn: (...a: unknown[]) => void, _ms?: number, ...a: unknown[]) => realSetTimeout(fn, 0, ...a)) as unknown as typeof setTimeout;
  globalThis.setTimeout = fast;
}

type Probe = "runs" | "skips";
/** Runs one search under the guard: "runs" when it tried the network (or found something), "skips" when it didn't. */
export async function probe(fn: () => Promise<unknown>): Promise<Probe> {
  // Every probe asks robots.txt afresh: a cached answer (a refusal under the guard above all) sends nothing, and
  // a search that would have reached the network must count as running.
  resetHostState();
  const before = attempts;
  let settled: "ok" | "err" | null = null, result: unknown, error: unknown;
  const p = fn().then((r) => { settled = "ok"; result = r; }, (e) => { settled = "err"; error = e; });
  await Promise.race([p, new Promise((r) => realSetTimeout(r, 4000))]);
  if (attempts > before) return "runs";
  if (settled === "ok") return Array.isArray(result) && result.length > 0 ? "runs" : "skips";
  // A source that needs a key we don't hold here doesn't run: it is not claimed (round 2, decision 13).
  if (settled === "err" && /not configured/i.test(String((error as Error)?.message ?? error))) return "skips";
  return settled === null ? "runs" : "skips"; // still waiting on something: it is working, not declining
}

// ── Kinds from labels (files and live enforcement searches carry no category of their own) ───────────────────────

const KIND_WORDS: [CoverageKind, RegExp][] = [
  ["courts", /\bcourts?\b|docket/i],
  ["stop_work", /stop[- ]work/i],
  ["debarment", /debar|suspended (contractors|vendors|firms)|exclu(ded|sion)|disqualif|ineligible/i],
  ["wage", /\bwage|labor standards|prevailing|payroll|labor (law|violation|list)|workers'? ?comp|employee classification|misclassif|workplace accountability/i],
  ["debarment", /watch ?list/i],
  ["tax_lien", /\blien/i],
  ["environmental", /environment|\bDEQ\b|\bDEP\b|\bTCEQ\b|\bTDEC\b|\bEPD\b|\bDEEP\b|air quality|water quality|pollution/i],
  ["business_status", /secretary of state|business (entit|registration|status|filing)|corporations?\b|entity status|good standing|franchise[- ]tax/i],
  ["complaints", /complaint/i],
  ["discipline", /disciplin|board (action|order)|revo(ked|cation)|sanction|violation|enforcement|\border|citation|penalt|hearing|arbitration|guaranty fund/i],
];
export function kindOfLabel(label: string): CoverageKind {
  return KIND_WORDS.find(([, re]) => re.test(label))?.[0] ?? "other";
}

// ── The manifest ──────────────────────────────────────────────────────────────────────────────────────────────────

const PROBE_COMPANY = "Acme Builders";
const PROBE_PERSON = "John Smith";
const PROBE_IDS = [
  { type: "license" as const, value: "EC1234567", id: "license" as const },
  { type: "phone" as const, value: "(202) 555-0143", id: "phone" as const },
  { type: "address" as const, value: "100 Main St, Springfield 62701", id: "address" as const },
];

const sortIds = (ids: Iterable<CoverageId>) => COVERAGE_ID_ORDER.filter((i) => new Set(ids).has(i));
const sortKinds = (kinds: Iterable<CoverageKind>) => COVERAGE_KIND_ORDER.filter((k) => new Set(kinds).has(k));

/** Builds the manifest. Call installNetworkGuard() first (the probes would otherwise run real searches). */
export async function buildCoverageManifest(): Promise<CoverageManifest> {
  if (!guarded) throw new Error("installNetworkGuard() first: the probes would run real searches");
  const registry = await import("./registry");
  const { complaintSourcesFor, searchCompanyRecords } = await import("./records");
  const { searchStateEnforcement } = await import("./state-records");
  const { STATE_PACKS } = await import("./states");
  const local = await import("./states/local");
  const packs = new Map(STATE_PACKS.map((p) => [p.state, p]));
  const localLicense = new Set(local.LOCAL_LICENSES), localBulk = new Set(local.LOCAL_BULK);
  const localLive = new Set(Object.values(local.LOCAL_LIVE).flat());

  const states: CoverageState[] = [];
  for (const state of STATE_CODES) {
    const pack = packs.get(state);
    const sources: CoverageSource[] = [];

    for (const src of registry.allBulkSourcesFor(state)) {
      sources.push({
        label: src.label, kinds: [src.companiesOnly ? (src.category ? KIND_OF_CATEGORY[src.category] : kindOfLabel(src.label)) : "licenses"], ids: ["name"], mode: "file",
        refreshHours: src.everyHours, fileId: src.id, local: localBulk.has(src) || undefined, companiesOnly: !!src.companiesOnly, url: src.pageUrl || null,
      });
    }
    for (const src of registry.allLicenseSourcesFor(state)) {
      const ids: CoverageId[] = [];
      if (src.fields.businessName) ids.push("name");
      if (src.personField || src.principals) ids.push("owner");
      if (src.fields.licenseNumber) ids.push("license");
      if (src.phone) ids.push("phone");
      if (src.address) ids.push("address");
      sources.push({ label: src.source, kinds: ["licenses"], ids, mode: "live", local: localLicense.has(src) || undefined, companiesOnly: false, url: src.datasetUrl });
    }
    for (const src of registry.liveLicenseSearchesFor(state)) {
      const ids: CoverageId[] = [];
      if (await probe(() => src.search(PROBE_COMPANY, "company")) === "runs") ids.push("name");
      if (await probe(() => src.search(PROBE_PERSON, "person")) === "runs") ids.push("owner");
      if (src.searchBy) for (const q of PROBE_IDS) if (await probe(() => src.searchBy!({ type: q.type, value: q.value })) === "runs") ids.push(q.id);
      sources.push({ label: src.source, kinds: ["licenses"], ids: sortIds(ids), mode: "live", local: localLive.has(src) || undefined, companiesOnly: false, url: src.sourceUrl });
    }
    for (const src of pack?.enforcement ?? []) {
      let cat: EnforcementCategory | null = null;
      try { cat = src.toHit({}).category; } catch { /* a toHit that needs fields: fall back to the label */ }
      sources.push({ label: src.source, kinds: [cat ? KIND_OF_CATEGORY[cat] : kindOfLabel(src.source)], ids: ["name"], mode: "live", companiesOnly: true, url: src.datasetUrl });
    }
    for (const src of pack?.liveEnforcement ?? []) {
      sources.push({ label: src.source, kinds: [src.category ? KIND_OF_CATEGORY[src.category] : kindOfLabel(`${src.source} ${src.scope}`)], ids: ["name"], mode: "live", companiesOnly: true, url: null });
    }
    // The original tables' live enforcement (TX Comptroller, TCEQ, TDLR orders, …): the report's own source list.
    const original = await searchStateEnforcement(PROBE_COMPANY, state, () => true).catch(() => ({ sources: [] as { source: string }[] }));
    for (const s of original.sources) {
      if (sources.some((x) => x.label === s.source)) continue;
      sources.push({ label: s.source, kinds: [kindOfLabel(s.source)], ids: ["name"], mode: "live", companiesOnly: true, url: null });
    }
    for (const src of complaintSourcesFor(state)) {
      if (sources.some((x) => x.label === src.source)) continue;
      sources.push({ label: src.source, kinds: ["complaints"], ids: ["name"], mode: "live", companiesOnly: true, url: src.datasetUrl });
    }

    states.push({
      state, checked: pack?.checked || null,
      sources: sources.map((s) => ({ ...s, ids: sortIds(s.ids), kinds: sortKinds(s.kinds) })),
      noStatewideGcLicense: registry.noStatewideGcLicense(state),
      unavailableCount: pack?.blocked?.length ?? 0,
    });
  }

  // Nationwide records: whatever the report lists with a nationwide scope.
  const all = await searchCompanyRecords(PROBE_COMPANY, []);
  // A source switched off ("Not searched by ConstructHUB": CourtListener, robots.txt) is not claimed. OSHA is listed
  // with `needs: "osha"` whether or not the BUILD holds the Labor Department key: the running server decides
  // (coverage.ts coverageRuntime; round 4).
  const nationwide: CoverageSource[] = all.sources
    .filter((s) => /^all /i.test(s.scope) && !s.note.startsWith("Not searched by ConstructHUB"))
    .map((s) => ({ label: s.source, kinds: [/OSHA/.test(s.source) ? "other" as const : kindOfLabel(s.source)], ids: ["name" as const], mode: "live" as const, companiesOnly: true, url: null,
      ...(s.category === "osha" ? { needs: "osha" as const } : {}) }));

  return { generatedAt: new Date().toISOString(), states, nationwide };
}
