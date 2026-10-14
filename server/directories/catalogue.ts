import { loadScoutedDirectories, toDirectoryRow } from "./scouted";

/** Catalogue sources are discovery evidence, never proof of a business entry or API access.
 * Semrush US list: https://www.semrush.com/kb/874-entry-management-citation-websites (2026-10-13).
 * Null requirements/trades/states mean unresearched, not unrestricted/free.
 */
export type DirectorySeed = {
  name: string;
  domain: string;
  kind: string;
  tier: number;
  category: string;
  source: string;
  notes: string | null;
};
const checklist: [string, string, string][] = [
  ["Google Business Profile", "google.com", "maps_nav"],
  ["Yelp", "yelp.com", "general"],
  ["BBB", "bbb.org", "general"],
  ["Yellow Pages", "yellowpages.com", "general"],
  ["Angi", "angi.com", "contractor"],
  ["HomeAdvisor", "homeadvisor.com", "contractor"],
  ["Houzz", "houzz.com", "contractor"],
  ["Facebook", "facebook.com", "social"],
  ["Nextdoor", "nextdoor.com", "social"],
  ["Thumbtack", "thumbtack.com", "contractor"],
  ["MapQuest", "mapquest.com", "maps_nav"],
  ["Superpages", "superpages.com", "general"],
  ["DexKnows", "dexknows.com", "general"],
  ["CitySearch", "citysearch.com", "general"],
  ["Manta", "manta.com", "general"],
  ["MerchantCircle", "merchantcircle.com", "general"],
  ["Foursquare", "foursquare.com", "general"],
  ["Apple Maps", "maps.apple.com", "maps_nav"],
  ["Bing Places", "bing.com", "maps_nav"],
  ["TripAdvisor", "tripadvisor.com", "general"],
  ["Buildzoom", "buildzoom.com", "contractor"],
  ["Porch", "porch.com", "contractor"],
  ["Bark", "bark.com", "contractor"],
  ["Expertise", "expertise.com", "general"],
  ["Chamber of Commerce", "chamberofcommerce.com", "general"],
  ["HotFrog", "hotfrog.com", "general"],
  ["Brownbook", "brownbook.net", "general"],
  ["ShowMeLocal", "showmelocal.com", "general"],
  ["EZLocal", "ezlocal.com", "general"],
  ["Local.com", "local.com", "general"],
];
const semrush: [string, string, string?][] = [
  ["8coupons", "8coupons.com"],
  ["Amazon Alexa", "alexa.amazon.com", "ai"],
  ["American Express", "americanexpress.com"],
  ["Apple Maps", "maps.apple.com", "maps_nav"],
  ["AroundMe", "aroundmeapp.com", "maps_nav"],
  ["BBB", "bbb.org"],
  ["Bing Places", "bing.com", "maps_nav"],
  ["Brave", "brave.com"],
  ["Brownbook", "brownbook.net"],
  ["Central Index US", "centralindex.com"],
  ["Chamber of Commerce", "chamberofcommerce.com"],
  ["Citysearch", "citysearch.com"],
  ["CitySquares", "citysquares.com"],
  ["Cylex", "cylex.us.com"],
  ["DoorDash", "doordash.com"],
  ["Dun & Bradstreet", "dnb.com"],
  ["eLocal", "elocal.com"],
  ["EZlocal", "ezlocal.com"],
  ["Facebook", "facebook.com", "social"],
  ["Foursquare", "foursquare.com", "maps_nav"],
  ["GoLocal247", "golocal247.com"],
  ["Google Business Profile", "google.com", "maps_nav"],
  ["HERE", "here.com", "maps_nav"],
  ["HostMe", "hostmeapp.com"],
  ["Hotfrog", "hotfrog.com"],
  ["Hours.com", "hours.com"],
  ["iBegin", "ibegin.com"],
  ["iGlobal", "iglobal.co"],
  ["Insider Pages", "insiderpages.com"],
  ["Instacart", "instacart.com"],
  ["Mapbox", "mapbox.com", "maps_nav"],
  ["MapQuest", "mapquest.com", "maps_nav"],
  ["Mapstr", "mapstr.com", "maps_nav"],
  ["MerchantCircle", "merchantcircle.com"],
  ["Money Mailer", "moneymailer.com"],
  ["My Local Services", "mylocalservices.com"],
  ["n49", "n49.com"],
  ["Navmii", "navmii.com", "maps_nav"],
  ["Nextdoor", "nextdoor.com", "social"],
  ["OpenAI", "openai.com", "ai"],
  ["Opendi", "opendi.us"],
  ["Pitney Bowes", "pitneybowes.com"],
  ["Property Capsule", "propertycapsule.com"],
  ["Quinceanera.com", "quinceanera.com"],
  ["SafeGraph", "safegraph.com"],
  ["ShowMeLocal", "showmelocal.com"],
  ["Snapchat", "snapchat.com", "social"],
  ["Soleo", "soleo.com"],
  ["tellows", "tellows.com"],
  ["TikTok", "tiktok.com", "social"],
  ["TomTom", "tomtom.com", "maps_nav"],
  ["Top Rated Local", "topratedlocal.com"],
  ["TripAdvisor", "tripadvisor.com"],
  ["Tupalo", "tupalo.com"],
  ["Uber Eats", "ubereats.com"],
  ["Uber", "uber.com", "maps_nav"],
  ["USCity.net", "uscity.net"],
  ["Where To?", "whereto.app", "maps_nav"],
  ["Winnie", "winnie.com"],
  ["wogibtswas.de", "wogibtswas.de"],
  ["Yahoo", "yahoo.com"],
  ["Yandex", "yandex.com"],
  ["YellowPagesDirectory", "yellowpagesdirectory.com"],
  ["Yelp", "yelp.com"],
  ["Yellow Pages", "yellowpages.com"],
  ["Siri", "apple.com", "ai"],
];
// RexLocal is named in the KB, but its US publisher domain could not be substantiated.
// Do not substitute the unrelated Australian rexlocal.io or invent a domain.
export const unresolvedDirectories = [
  {
    name: "RexLocal",
    domain: null,
    source: "semrush-kb-874",
    notes:
      "US publisher domain needs research: https://www.yext.com/integrations/publishers/rexlocal",
  },
];
export function catalogue(): DirectorySeed[] {
  const byDomain = new Map<string, DirectorySeed>();
  for (const [name, domain, category] of checklist)
    byDomain.set(domain, {
      name,
      domain,
      category,
      kind: "submission",
      tier: 4,
      source: "citations-checklist",
      notes: null,
    });
  for (const [name, domain, category] of semrush)
    byDomain.set(domain, {
      name,
      domain,
      category: category ?? "general",
      kind: "partner",
      tier: 3,
      source: "semrush-kb-874",
      notes:
        "Source-listed distribution target; eligibility and access unconfirmed.",
    });
  for (const [domain, name] of [
    ["google.com", "Google Business Profile"],
    ["bing.com", "Bing Places"],
    ["maps.apple.com", "Apple Business Connect"],
    ["facebook.com", "Facebook"],
    ["foursquare.com", "Foursquare"],
    ["yelp.com", "Yelp-claim"],
  ]) {
    const d = byDomain.get(domain)!;
    byDomain.set(domain, {
      ...d,
      name,
      tier: 1,
      kind: domain === "yelp.com" ? "submission" : "api",
      notes:
        domain === "yelp.com"
          ? "Claim only; no write API. Also citations checklist and Semrush KB 874."
          : "Phase 2 API target; integration not implied. Also citations checklist and Semrush KB 874.",
    });
  }
  return [...byDomain.values()];
}
export async function seedDirectories(db: {
  query: (sql: string, values?: any[]) => Promise<unknown>;
}) {
  for (const d of catalogue())
    await db.query(
      `INSERT INTO listing_directories(name,domain,kind,tier,category,source,notes)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(domain) DO NOTHING`,
      [d.name, d.domain, d.kind, d.tier, d.category, d.source, d.notes],
    );
  // Scouted long tail (tier 4). DO NOTHING on any conflict: an admin's edits to an existing row are never overwritten,
  // and a scouted name that collides with an existing directory is skipped rather than renamed.
  for (const scouted of loadScoutedDirectories()) {
    let row;
    try {
      row = toDirectoryRow(scouted);
    } catch {
      continue; // the build script validates rows; a bad one never blocks boot
    }
    await db.query(
      `INSERT INTO listing_directories(name,domain,kind,tier,category,trades,states,requires_street_address,
   requires_phone_verification,requires_postcard,paid,active,source,notes)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
      [
        row.name,
        row.domain,
        row.kind,
        row.tier,
        row.category,
        row.trades,
        row.states,
        row.requires_street_address,
        row.requires_phone_verification,
        row.requires_postcard,
        row.paid,
        row.active,
        row.source,
        row.notes,
      ],
    );
  }
  for (const d of unresolvedDirectories)
    await db.query(
      `INSERT INTO listing_directories(name,domain,kind,tier,category,source,notes,active)
 VALUES($1,NULL,'partner',3,'contractor',$2,$3,false) ON CONFLICT(name) DO NOTHING`,
      [d.name, d.source, d.notes],
    );
}
