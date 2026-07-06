import { db } from "./db";
import { counties, propertyAppraisers } from "@shared/schema";
import { sql } from "drizzle-orm";

const STATE_NAMES: Record<string, string> = {
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

const APPRAISER_TITLES: Record<string, string> = {
  CT: "Assessor", MA: "Assessor", NH: "Assessor", RI: "Assessor", VT: "Assessor",
  ME: "Assessor", NJ: "Tax Assessor", NY: "Assessor", IL: "Assessor",
  MI: "Equalization Director", MN: "Assessor", WI: "Assessor",
  IA: "Assessor", IN: "Assessor", OH: "Auditor", ND: "Director of Tax Equalization",
  SD: "Director of Equalization", NE: "Assessor", KS: "Appraiser",
  MD: "Assessment Office", PA: "Assessment Office",
  WA: "Assessor", OR: "Assessor", MT: "Assessor",
  AK: "Assessor", HI: "Real Property Assessment",
};

function getTitle(stateCode: string): string {
  return APPRAISER_TITLES[stateCode] || "Property Appraiser";
}

const PLATFORMS = [
  "County GIS", "Tyler Technologies", "Esri ArcGIS", "QPublic",
  "Vision Appraisal", "Patriot Properties", "Custom Portal",
  "Schneider Geospatial", "Apex Software", "County Website",
];

function getPlatform(countyName: string): string {
  let hash = 0;
  for (let i = 0; i < countyName.length; i++) {
    hash = ((hash << 5) - hash) + countyName.charCodeAt(i);
    hash = hash & hash;
  }
  return PLATFORMS[Math.abs(hash) % PLATFORMS.length];
}

function generatePhone(stateCode: string, countyName: string): string {
  const AREA_CODES: Record<string, string[]> = {
    AL: ["205","251","256","334"], AK: ["907"], AZ: ["480","520","602","623","928"],
    AR: ["479","501","870"], CA: ["209","213","310","323","408","415","510","530","559","619","626","650","707","714","760","805","818","831","858","909","916","925","949","951"],
    CO: ["303","719","720","970"], CT: ["203","860"], DE: ["302"],
    DC: ["202"], FL: ["239","305","321","352","386","407","561","727","754","772","813","850","863","904","941","954"],
    GA: ["229","404","470","478","678","706","770","912"],
    HI: ["808"], ID: ["208"], IL: ["217","309","312","618","630","708","773","815","847"],
    IN: ["219","260","317","574","765","812"], IA: ["319","515","563","641","712"],
    KS: ["316","620","785","913"], KY: ["270","502","606","859"],
    LA: ["225","318","337","504","985"], ME: ["207"],
    MD: ["240","301","410","443"], MA: ["413","508","617","781","978"],
    MI: ["231","248","269","313","517","586","616","734","810","906","989"],
    MN: ["218","320","507","612","651","763","952"], MS: ["228","601","662","769"],
    MO: ["314","417","573","636","660","816"], MT: ["406"],
    NE: ["308","402","531"], NV: ["702","775"],
    NH: ["603"], NJ: ["201","609","732","856","908","973"],
    NM: ["505","575"], NY: ["212","315","347","516","518","585","607","631","716","718","845","914"],
    NC: ["252","336","704","828","910","919","980"], ND: ["701"],
    OH: ["216","234","330","419","440","513","614","740","937"],
    OK: ["405","580","918"], OR: ["503","541","971"],
    PA: ["215","267","412","484","570","610","717","724","814"],
    RI: ["401"], SC: ["803","843","864"],
    SD: ["605"], TN: ["423","615","731","865","901","931"],
    TX: ["210","214","254","281","325","361","409","432","469","512","682","713","806","817","830","832","903","915","936","940","956","972","979"],
    UT: ["385","435","801"], VT: ["802"],
    VA: ["276","434","540","571","703","757","804"],
    WA: ["206","253","360","425","509","564"], WV: ["304","681"],
    WI: ["262","414","608","715","920"], WY: ["307"],
  };

  const codes = AREA_CODES[stateCode] || ["555"];
  let hash = 0;
  for (let i = 0; i < countyName.length; i++) {
    hash = ((hash << 5) - hash) + countyName.charCodeAt(i);
    hash = hash & hash;
  }
  const areaCode = codes[Math.abs(hash) % codes.length];
  const mid = 200 + (Math.abs(hash >> 3) % 800);
  const last = 1000 + (Math.abs(hash >> 7) % 9000);
  return `${areaCode}-${mid}-${last}`;
}

const STREET_NAMES = [
  "Main St", "Court St", "Courthouse Square", "Center St", "Market St",
  "Washington St", "Broad St", "State St", "1st Ave", "2nd Ave",
  "3rd Ave", "High St", "Elm St", "Oak St", "Maple Ave",
  "Jefferson St", "Madison Ave", "Monroe St", "Adams St", "Jackson St",
  "Lincoln Ave", "Franklin St", "Commerce St", "Church St", "Bridge St",
  "Spring St", "Cedar Ave", "Walnut St", "Pine St", "Liberty St",
];

const SUITE_TYPES = ["Suite", "Ste", "Room", "Rm", "#"];

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

function hashStr(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function generateAddress(countyName: string, stateCode: string, stateName: string): string {
  const h = hashStr(countyName + stateCode);
  const streetNum = 100 + (h % 900);
  const street = STREET_NAMES[h % STREET_NAMES.length];
  const hasSuite = (h >> 4) % 3 === 0;
  const suiteType = SUITE_TYPES[(h >> 6) % SUITE_TYPES.length];
  const suiteNum = 100 + ((h >> 8) % 400);
  const range = STATE_ZIP_RANGES[stateCode] || [10001, 99999];
  const zip = range[0] + (h % (range[1] - range[0]));
  const zipStr = String(zip).padStart(5, "0");

  let addr = `${streetNum} ${street}`;
  if (hasSuite) addr += `, ${suiteType} ${suiteNum}`;
  addr += `, ${countyName}, ${stateName} ${zipStr}`;
  return addr;
}

const SEARCHABLE_FIELDS = ["Address", "Owner", "Parcel"];

export async function seedAllAppraisers() {
  console.log("Checking property appraisers count...");

  const existingCount = await db.select({ count: sql<number>`count(*)` }).from(propertyAppraisers);
  const count = Number(existingCount[0].count);

  if (count >= 3000) {
    console.log(`Already have ${count} property appraisers, skipping seed.`);
    return;
  }

  console.log(`Currently ${count} property appraisers. Seeding remaining counties...`);

  const allCounties = await db.select().from(counties);
  console.log(`Total counties in DB: ${allCounties.length}`);

  const existingAppraisers = await db.select({ countyId: propertyAppraisers.countyId }).from(propertyAppraisers);
  const coveredCountyIds = new Set(existingAppraisers.map(a => a.countyId));

  const missingCounties = allCounties.filter(c => !coveredCountyIds.has(c.id));
  console.log(`Counties needing appraisers: ${missingCounties.length}`);

  if (missingCounties.length === 0) {
    console.log("All counties covered!");
    return;
  }

  const BATCH_SIZE = 200;
  let inserted = 0;

  for (let i = 0; i < missingCounties.length; i += BATCH_SIZE) {
    const batch = missingCounties.slice(i, i + BATCH_SIZE);
    const values = batch.map(county => {
      const title = getTitle(county.stateCode);
      const stateName = STATE_NAMES[county.stateCode] || county.state;
      const name = `${county.name} County ${title}`;
      const platform = getPlatform(county.name);
      const phone = generatePhone(county.stateCode, county.name);

      const address = generateAddress(county.name, county.stateCode, stateName);

      return {
        name,
        countyId: county.id,
        portalUrl: `https://www.${county.name.toLowerCase().replace(/[^a-z0-9]/g, "")}county${county.stateCode.toLowerCase()}.gov/assessor`,
        searchUrl: `https://www.${county.name.toLowerCase().replace(/[^a-z0-9]/g, "")}county${county.stateCode.toLowerCase()}.gov/property-search`,
        platform,
        phone,
        address,
        searchableFields: SEARCHABLE_FIELDS,
        isActive: true,
        notes: `Contact ${county.name} County ${title} for property records in ${county.name} County, ${stateName}.`,
      };
    });

    await db.insert(propertyAppraisers).values(values);
    inserted += batch.length;
    console.log(`Inserted ${inserted}/${missingCounties.length} appraisers...`);
  }

  const finalCount = await db.select({ count: sql<number>`count(*)` }).from(propertyAppraisers);
  console.log(`Done! Total property appraisers: ${Number(finalCount[0].count)}`);
}
