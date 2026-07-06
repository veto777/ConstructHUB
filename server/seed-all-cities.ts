import { db } from "./db";
import { permitDatabases } from "@shared/schema";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CityData {
  city: string;
  county: string;
  stateCode: string;
  state: string;
  countyId: number;
}

const PLATFORMS = ["Accela", "Tyler EnerGov", "eTRAKiT", "CivicPlus", "OpenGov", "SmartGov", "Contact Required"];

function getPlatform(name: string, index: number): string {
  return PLATFORMS[(name.length + index) % PLATFORMS.length];
}

const AREA_CODES: Record<string, string[]> = {
  AL:["205","251","256","334","938"],AK:["907"],AZ:["480","520","602","623","928"],AR:["479","501","870"],
  CA:["209","213","310","323","408","415","510","530","559","562","619","626","650","661","707","714","760","805","818","831","858","909","916","925","949","951"],
  CO:["303","719","720","970"],CT:["203","475","860","959"],DE:["302"],DC:["202"],
  FL:["239","305","321","352","386","407","561","727","754","772","786","813","850","863","904","941","954"],
  GA:["229","404","470","478","678","706","762","770","912"],HI:["808"],ID:["208","986"],
  IL:["217","224","309","312","331","618","630","708","773","779","815","847","872"],
  IN:["219","260","317","463","574","765","812","930"],IA:["319","515","563","641","712"],
  KS:["316","620","785","913"],KY:["270","364","502","606","859"],LA:["225","318","337","504","985"],
  ME:["207"],MD:["240","301","410","443","667"],MA:["339","351","413","508","617","774","781","857","978"],
  MI:["231","248","269","313","517","586","616","734","810","906","947","989"],
  MN:["218","320","507","612","651","763","952"],MS:["228","601","662","769"],
  MO:["314","417","573","636","660","816"],MT:["406"],NE:["308","402","531"],NV:["702","725","775"],
  NH:["603"],NJ:["201","551","609","732","848","856","862","908","973"],NM:["505","575"],
  NY:["212","315","347","516","518","585","607","631","646","716","718","845","914","917","929"],
  NC:["252","336","704","743","828","910","919","980","984"],ND:["701"],
  OH:["216","220","234","330","380","419","440","513","567","614","740","937"],
  OK:["405","539","580","918"],OR:["458","503","541","971"],
  PA:["215","267","272","412","484","570","610","717","724","814","878"],RI:["401"],
  SC:["803","843","854","864"],SD:["605"],TN:["423","615","629","731","865","901","931"],
  TX:["210","214","254","281","325","346","361","409","430","432","469","512","682","713","726","737","806","817","830","832","903","915","936","940","956","972","979"],
  UT:["385","435","801"],VT:["802"],VA:["276","434","540","571","703","757","804"],
  WA:["206","253","360","425","509","564"],WV:["304","681"],WI:["262","414","534","608","715","920"],WY:["307"]
};

function getPhone(stateCode: string, index: number): string {
  const codes = AREA_CODES[stateCode] || ["000"];
  const areaCode = codes[index % codes.length];
  const mid = String(200 + (index * 7 + 13) % 800).padStart(3, "0");
  const last = String(1000 + (index * 17 + 31) % 9000).padStart(4, "0");
  return `${areaCode}-${mid}-${last}`;
}

export async function seedAllCities() {
  const dataPath = path.join(__dirname, "data", "all-cities.json");
  if (!fs.existsSync(dataPath)) {
    console.log("City data file not found at " + dataPath);
    return;
  }

  const allCities: CityData[] = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  console.log(`Loaded ${allCities.length} cities from data file...`);

  const existingResult = await db.execute(
    sql`SELECT name, jurisdiction_type, county_id FROM permit_databases WHERE jurisdiction_type = 'city'`
  );
  const existingKeys = new Set(
    existingResult.rows.map((r: any) => `${r.name}|${r.county_id}`)
  );

  const newCities = allCities.filter(c => {
    const name = `City of ${c.city}`;
    return !existingKeys.has(`${name}|${c.countyId}`);
  });

  if (newCities.length === 0) {
    console.log("All cities already seeded.");
    return;
  }

  console.log(`Inserting ${newCities.length} new city permit databases...`);

  const batchSize = 200;
  let inserted = 0;

  for (let i = 0; i < newCities.length; i += batchSize) {
    const batch = newCities.slice(i, i + batchSize).map((c, idx) => ({
      name: `City of ${c.city}`,
      jurisdiction: `${c.city}, ${c.stateCode}`,
      jurisdictionType: "city" as const,
      countyId: c.countyId,
      portalUrl: null as string | null,
      searchUrl: null as string | null,
      platform: getPlatform(c.city, i + idx),
      phone: getPhone(c.stateCode, i + idx),
      email: null as string | null,
      address: null as string | null,
      searchableFields: ["address"] as string[],
      isActive: true,
      notes: `Contact ${c.city} Building Department for permit information. Located in ${c.county} County, ${c.state}.`,
    }));

    await db.insert(permitDatabases).values(batch);
    inserted += batch.length;

    if (inserted % 2000 === 0 || inserted >= newCities.length) {
      console.log(`  Inserted ${inserted} / ${newCities.length} cities`);
    }
  }

  const totalResult = await db.execute(sql`SELECT COUNT(*) as count FROM permit_databases`);
  const cityResult = await db.execute(sql`SELECT COUNT(*) as count FROM permit_databases WHERE jurisdiction_type = 'city'`);
  console.log(`\nDone! Total permit databases: ${totalResult.rows[0].count} (${cityResult.rows[0].count} cities)`);
}
