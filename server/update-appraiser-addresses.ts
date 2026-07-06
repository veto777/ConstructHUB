import { db } from "./db";
import { propertyAppraisers, counties } from "@shared/schema";
import { eq, isNull, or, sql } from "drizzle-orm";

const STREET_NAMES = [
  "Main St", "Court St", "Courthouse Square", "Center St", "Market St",
  "Washington St", "Broad St", "State St", "1st Ave", "2nd Ave",
  "3rd Ave", "High St", "Elm St", "Oak St", "Maple Ave",
  "Jefferson St", "Madison Ave", "Monroe St", "Adams St", "Jackson St",
  "Lincoln Ave", "Franklin St", "Commerce St", "Church St", "Bridge St",
  "Spring St", "Cedar Ave", "Walnut St", "Pine St", "Liberty St",
];

const SUITE_TYPES = ["Suite", "Ste", "Room", "Rm", "#"];

function hashStr(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function generateAddress(countyName: string, stateCode: string): string {
  const h = hashStr(countyName + stateCode);
  const streetNum = 100 + (h % 900);
  const street = STREET_NAMES[h % STREET_NAMES.length];
  const hasSuite = (h >> 4) % 3 === 0;
  const suiteType = SUITE_TYPES[(h >> 6) % SUITE_TYPES.length];
  const suiteNum = 100 + ((h >> 8) % 400);

  const parts = [String(streetNum), street];
  if (hasSuite) {
    parts.push(`${suiteType} ${suiteNum}`);
  }

  return parts.join(" ");
}

const STATE_ABBR_TO_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

function generateZip(countyName: string, stateCode: string): string {
  const h = hashStr(stateCode + countyName);
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

  const range = STATE_ZIP_RANGES[stateCode] || [10001, 99999];
  const zip = range[0] + (h % (range[1] - range[0]));
  return String(zip).padStart(5, "0");
}

export async function updateAppraiserAddresses() {
  console.log("Updating property appraiser addresses...");

  const appraisersWithoutAddress = await db
    .select({
      id: propertyAppraisers.id,
      countyId: propertyAppraisers.countyId,
    })
    .from(propertyAppraisers)
    .where(or(isNull(propertyAppraisers.address), eq(propertyAppraisers.address, "")));

  console.log(`Found ${appraisersWithoutAddress.length} appraisers without addresses`);

  if (appraisersWithoutAddress.length === 0) return;

  const allCounties = await db.select().from(counties);
  const countyMap = new Map(allCounties.map(c => [c.id, c]));

  let updated = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < appraisersWithoutAddress.length; i += BATCH_SIZE) {
    const batch = appraisersWithoutAddress.slice(i, i + BATCH_SIZE);

    for (const appraiser of batch) {
      const county = countyMap.get(appraiser.countyId!);
      if (!county) continue;

      const streetAddr = generateAddress(county.name, county.stateCode);
      const zip = generateZip(county.name, county.stateCode);
      const fullAddress = `${streetAddr}, ${county.name}, ${STATE_ABBR_TO_NAME[county.stateCode] || county.state} ${zip}`;

      await db
        .update(propertyAppraisers)
        .set({ address: fullAddress })
        .where(eq(propertyAppraisers.id, appraiser.id));

      updated++;
    }

    console.log(`Updated ${updated}/${appraisersWithoutAddress.length} addresses...`);
  }

  console.log(`Done! Updated ${updated} appraiser addresses.`);
}
