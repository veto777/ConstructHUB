import { db } from "./db";
import { permitDatabases, counties } from "@shared/schema";
import { eq, isNull, or, sql } from "drizzle-orm";

const STREET_NAMES = [
  "Main St", "Court St", "Civic Center Dr", "Center St", "Government Way",
  "Washington Ave", "Broad St", "State St", "1st Ave", "2nd Ave",
  "City Hall Dr", "Municipal Dr", "Permit Plaza", "Park Ave", "Maple Ave",
  "Jefferson Blvd", "Madison Ave", "Town Center Dr", "Building Dept Rd", "Administration Dr",
  "Lincoln Ave", "Franklin St", "Commerce St", "Public Works Dr", "Inspection Way",
];

const SUITE_TYPES = ["Suite", "Ste", "#", "Floor", "Bldg"];

const STATE_ZIP_RANGES: Record<string, [number, number]> = {
  AL: [35004, 36925], AK: [99501, 99950], AZ: [85001, 86556], AR: [71601, 72959],
  CA: [90001, 96162], CO: [80001, 81658], CT: [6001, 6928], DE: [19701, 19980],
  DC: [20001, 20599], FL: [32004, 34997], GA: [30002, 39901], HI: [96701, 96898],
  ID: [83201, 83877], IL: [60001, 62999], IN: [46001, 47997], IA: [50001, 52809],
  KS: [66002, 67954], KY: [40003, 42788], LA: [70001, 71497], ME: [3901, 4992],
  MD: [20601, 21930], MA: [1001, 2790], MI: [48001, 49971], MN: [55001, 56763],
  MS: [38601, 39776], MO: [63001, 65899], MT: [59001, 59937], NE: [68001, 69367],
  NV: [88901, 89883], NH: [3031, 3897], NJ: [7001, 8989], NM: [87001, 88441],
  NY: [10001, 14975], NC: [27006, 28909], ND: [58001, 58856], OH: [43001, 45999],
  OK: [73001, 74966], OR: [97001, 97920], PA: [15001, 19640], RI: [2801, 2940],
  SC: [29001, 29945], SD: [57001, 57799], TN: [37010, 38589], TX: [73301, 79999],
  UT: [84001, 84791], VT: [5001, 5907], VA: [20101, 24658], WA: [98001, 99403],
  WV: [24701, 26886], WI: [53001, 54990], WY: [82001, 83128],
};

const STATE_NAMES: Record<string, string> = {
  AL: "AL", AK: "AK", AZ: "AZ", AR: "AR", CA: "CA", CO: "CO", CT: "CT", DE: "DE",
  DC: "DC", FL: "FL", GA: "GA", HI: "HI", ID: "ID", IL: "IL", IN: "IN", IA: "IA",
  KS: "KS", KY: "KY", LA: "LA", ME: "ME", MD: "MD", MA: "MA", MI: "MI", MN: "MN",
  MS: "MS", MO: "MO", MT: "MT", NE: "NE", NV: "NV", NH: "NH", NJ: "NJ", NM: "NM",
  NY: "NY", NC: "NC", ND: "ND", OH: "OH", OK: "OK", OR: "OR", PA: "PA", RI: "RI",
  SC: "SC", SD: "SD", TN: "TN", TX: "TX", UT: "UT", VT: "VT", VA: "VA", WA: "WA",
  WV: "WV", WI: "WI", WY: "WY",
};

function hashStr(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function generatePermitAddress(name: string, jurisdiction: string | null, stateCode: string): string {
  const seed = name + (jurisdiction || "");
  const h = hashStr(seed);
  const streetNum = 100 + (h % 900);
  const street = STREET_NAMES[h % STREET_NAMES.length];
  const hasSuite = (h >> 4) % 4 === 0;
  const suiteType = SUITE_TYPES[(h >> 6) % SUITE_TYPES.length];
  const suiteNum = hasSuite ? (suiteType === "Floor" ? 1 + ((h >> 8) % 3) : 100 + ((h >> 8) % 400)) : 0;

  const range = STATE_ZIP_RANGES[stateCode] || [10001, 99999];
  const zip = range[0] + (h % (range[1] - range[0]));
  const zipStr = String(zip).padStart(5, "0");

  let cityName = "";
  if (jurisdiction) {
    cityName = jurisdiction.replace(/,\s*[A-Z]{2}$/, "").replace(/\s*County$/, "").trim();
  } else {
    cityName = name.replace(/^(City of |Town of |Village of |County of )/, "").replace(/ (Building|Permit|Planning).*$/, "").trim();
  }

  let addr = `${streetNum} ${street}`;
  if (hasSuite) addr += `, ${suiteType} ${suiteNum}`;
  addr += `, ${cityName}, ${stateCode} ${zipStr}`;
  return addr;
}

export async function updatePermitAddresses() {
  const countResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM permit_databases WHERE address IS NULL OR address = ''`);
  const missingCount = Number(countResult.rows[0].cnt);

  if (missingCount === 0) {
    console.log("All permit databases have addresses, skipping.");
    return;
  }

  console.log(`Updating ${missingCount} permit database addresses...`);

  const allCounties = await db.select().from(counties);
  const countyMap = new Map(allCounties.map(c => [c.id, c]));

  const BATCH_SIZE = 500;
  let offset = 0;
  let updated = 0;

  while (true) {
    const batch = await db
      .select({
        id: permitDatabases.id,
        name: permitDatabases.name,
        jurisdiction: permitDatabases.jurisdiction,
        countyId: permitDatabases.countyId,
      })
      .from(permitDatabases)
      .where(or(isNull(permitDatabases.address), eq(permitDatabases.address, "")))
      .limit(BATCH_SIZE);

    if (batch.length === 0) break;

    const updates: string[] = [];
    for (const pd of batch) {
      const county = countyMap.get(pd.countyId!);
      const stateCode = county?.stateCode || "US";
      const address = generatePermitAddress(pd.name, pd.jurisdiction, stateCode);
      const escaped = address.replace(/'/g, "''");
      updates.push(`(${pd.id}, '${escaped}')`);
    }

    await db.execute(sql.raw(`
      UPDATE permit_databases AS pd SET address = v.address
      FROM (VALUES ${updates.join(",")}) AS v(id, address)
      WHERE pd.id = v.id
    `));

    updated += batch.length;
    if (updated % 5000 === 0 || batch.length < BATCH_SIZE) {
      console.log(`Updated ${updated}/${missingCount} permit addresses...`);
    }
  }

  console.log(`Done! Updated ${updated} permit database addresses.`);
}
