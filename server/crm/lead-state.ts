/**
 * Where a lead belongs — its state (WA / FL / TX) and, finer, its market (Tampa, St Petersburg, Bellingham…) — so
 * the Leads page can be filtered by place and can follow the division workspace in the ribbon. Leads rarely carry
 * an address (8,000 of Alpine's 8,137 have no state), so the place is read from what IS on the row, in this order,
 * and never guessed beyond it:
 *   1. the lead's own state / city fields;
 *   2. a market whose name or alias is written in the lead's city, message or form fields ("Property Address: …
 *      Tampa, FL");
 *   3. the site it came through: a "(FL)" tag on the source label; a host that names a market or its alias
 *      ("stpetesidingco.com" → St Petersburg, "alpineexteriorsbradenton.com" → Sarasota via its alias); a host that
 *      ends in one of the company's division states ("alpineexteriorsfl.com"); a host that names a real city whose
 *      state is one of the company's division states and only one of them (server/data/all-cities.json — the same
 *      reference data the permit tools use, never a hand list);
 *   4. the phone's area code, when the company has it on exactly one market (813 → Tampa); a code two markets share
 *      (360: Bellingham and Lynden) settles only the state;
 *   5. otherwise unknown — shown as "Unknown", never dropped from the list.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeUsState } from "@shared/divisions";
import { placeKey, UNKNOWN_MARKET, type LeadMarket } from "@shared/lead-markets";

export const UNKNOWN_STATE = "??";

export type LeadLike = {
  state?: string | null; city?: string | null; sourceLabel?: string | null; pageUrl?: string | null;
  message?: string | null; phone?: string | null; fields?: Record<string, unknown> | null;
};
export type LeadPlace = { state: string; market: string };

let cityIndex: Map<string, Set<string>> | null = null;
/** normalized city name (letters only, ≥ 5 letters) → the states that have a city of that name. */
function cities(): Map<string, Set<string>> {
  if (cityIndex) return cityIndex;
  cityIndex = new Map();
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [path.join(here, "..", "data", "all-cities.json"), path.join(process.cwd(), "server", "data", "all-cities.json"), path.join(process.cwd(), "dist", "data", "all-cities.json")];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) return cityIndex;
    const rows = JSON.parse(fs.readFileSync(file, "utf8")) as { city: string; stateCode: string }[];
    for (const r of rows) {
      const key = placeKey(String(r.city || ""));
      if (key.length < 5) continue;
      let set = cityIndex.get(key);
      if (!set) { set = new Set(); cityIndex.set(key, set); }
      set.add(String(r.stateCode).toUpperCase());
    }
  } catch { /* no reference data → host-city matching is simply off */ }
  return cityIndex;
}

/** "https://www.alpineexteriorsfl.com/contact" or "alpineexteriorsfl.com (FL)" → "alpineexteriorsfl". */
export function hostStem(lead: LeadLike): string | null {
  const raw = lead.pageUrl || lead.sourceLabel || "";
  const m = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)/i.exec(raw.trim());
  if (!m) return null;
  const host = m[1].toLowerCase().replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length < 2) return null;
  const stem = parts.length >= 3 && /^(com|net|org|co|us)$/.test(parts[parts.length - 1]) && parts[parts.length - 2].length <= 3
    ? parts[parts.length - 3] : parts[parts.length - 2];
  return stem.replace(/[^a-z0-9]/g, "") || null;
}

const areaCode = (phone: string | null | undefined): string | null => {
  const d = String(phone ?? "").replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return n.length === 10 ? n.slice(0, 3) : null;
};

/** The market whose name / alias appears as a whole word in free text ("… Tampa, FL …"). Longest alias wins. */
function marketInText(text: string, markets: LeadMarket[]): LeadMarket | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  let best: { len: number; m: LeadMarket } | null = null;
  for (const m of markets) for (const a of m.aliases) {
    const needle = ` ${a.replace(/[^a-z0-9]+/g, " ").trim()} `;
    if (needle.trim().length < 4 || !t.includes(needle)) continue;
    if (!best || needle.length > best.len) best = { len: needle.length, m };
  }
  return best?.m ?? null;
}

/** The market whose name / alias is inside the host stem ("stpetesidingco" → St Petersburg). Longest wins. */
function marketInHost(stem: string, markets: LeadMarket[]): LeadMarket | null {
  let best: { len: number; m: LeadMarket } | null = null;
  for (const m of markets) for (const a of m.aliases) {
    const k = placeKey(a);
    if (k.length < 4 || !stem.includes(k)) continue;
    if (!best || k.length > best.len) best = { len: k.length, m };
  }
  return best?.m ?? null;
}

export function leadPlaceOf(lead: LeadLike, divisionStates: readonly string[], markets: LeadMarket[] = [], opts: { companyName?: string | null } = {}): LeadPlace {
  const states = divisionStates.map((s) => normalizeUsState(s)).filter(Boolean) as string[];
  // Words of the company's own name never count as a city in its hosts ("alpine…" is not Alpine, TX).
  const brand = new Set(String(opts.companyName ?? "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4));
  let state: string | null = normalizeUsState(lead.state);
  let market: LeadMarket | null = null;

  // 1–2. The lead's own city, or a market named in its text.
  const ownText = [lead.city, lead.message, ...Object.values(lead.fields ?? {}).map((v) => (typeof v === "string" ? v : ""))].filter(Boolean).join(" \n ");
  if (ownText.trim()) market = marketInText(ownText, markets);
  // 3. The site it came through.
  if (!state) {
    const tagged = /\(([A-Za-z]{2})\)/.exec(lead.sourceLabel ?? "");
    state = tagged ? normalizeUsState(tagged[1]) : null;
  }
  const stem = hostStem(lead);
  if (stem) {
    if (!market) market = marketInHost(stem, markets);
    const letters = stem.replace(/[0-9]/g, "");
    if (!state) for (const s of states) if (letters.length > 2 && letters.endsWith(s.toLowerCase())) { state = s; break; }
    if (!state && !market) {
      // A real city in the host whose state (among the company's) is unambiguous — longest city name wins.
      let best: { len: number; state: string } | null = null;
      for (const [city, set] of cities()) {
        if (city.length < 7 || brand.has(city) || !letters.includes(city)) continue;
        const mine = states.filter((s) => set.has(s));
        if (mine.length !== 1) continue;
        if (!best || city.length > best.len) best = { len: city.length, state: mine[0] };
      }
      if (best) state = best.state;
    }
  }
  // 4. The phone's area code: one market → that market; shared by two → only the state they share.
  if (!market) {
    const code = areaCode(lead.phone);
    if (code) {
      const owners = markets.filter((m) => m.areaCodes.includes(code));
      if (owners.length === 1) market = owners[0];
      else if (owners.length > 1 && !state && new Set(owners.map((m) => m.state)).size === 1) state = owners[0].state;
    }
  }
  // A market carries its state; a state never picks a market.
  if (market && (!state || state === market.state)) state = market.state;
  if (market && state && state !== market.state) market = null; // the row says another state — trust the row
  return { state: state ?? UNKNOWN_STATE, market: market?.key ?? UNKNOWN_MARKET };
}

/** Back-compat for the state alone. */
export const leadStateOf = (lead: LeadLike, divisionStates: readonly string[], markets: LeadMarket[] = [], opts: { companyName?: string | null } = {}) => leadPlaceOf(lead, divisionStates, markets, opts).state;
