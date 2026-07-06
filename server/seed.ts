import { db } from "./db";
import { counties, permitDatabases } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { seedExpandedStates } from "./seed-all-states";
import { seedAllCounties } from "./seed-all-counties";
import { seedAllCities } from "./seed-all-cities";
import { seedAllAppraisers } from "./seed-all-appraisers";
import { updateAppraiserAddresses } from "./update-appraiser-addresses";
import { updatePermitAddresses } from "./update-permit-addresses";
import { seedReferenceData } from "./seed-reference-data";

export async function seedDatabase() {
  await seedReferenceData();

  const existing = await db.select().from(counties);
  if (existing.length >= 3000) {
    const dbCount = await db.execute(sql`SELECT COUNT(*) as count FROM permit_databases`);
    const totalDbs = Number(dbCount.rows[0].count);
    if (totalDbs < 20000) {
      console.log(`Counties done (${existing.length}), but only ${totalDbs} permit databases. Seeding cities...`);
      await seedAllCities();
    }
    await seedAllAppraisers();
    await updateAppraiserAddresses();
    await updatePermitAddresses();
    return;
  }
  if (existing.length > 0 && existing.length < 3000) {
    console.log(`Only ${existing.length} counties found, seeding all US counties...`);
    await seedAllCounties();
    await seedAllCities();
    return;
  }

  const [whatcom] = await db.insert(counties).values({ name: "Whatcom", state: "Washington", stateCode: "WA" }).returning();
  const [skagit] = await db.insert(counties).values({ name: "Skagit", state: "Washington", stateCode: "WA" }).returning();
  const [island] = await db.insert(counties).values({ name: "Island", state: "Washington", stateCode: "WA" }).returning();
  const [sanJuan] = await db.insert(counties).values({ name: "San Juan", state: "Washington", stateCode: "WA" }).returning();

  const dbs = [
    {
      name: "Whatcom County PDS",
      jurisdiction: "Whatcom County (unincorporated)",
      jurisdictionType: "county",
      countyId: whatcom.id,
      portalUrl: "https://www.whatcomcounty.us/4547/Customer-Service-Portal",
      searchUrl: "https://www.whatcomcounty.us/4547/Customer-Service-Portal",
      platform: "Tyler Technologies",
      phone: "360-778-5900",
      email: "permitportalhelp@co.whatcom.wa.us",
      address: "5280 Northwest Drive, Bellingham WA 98226",
      searchableFields: ["address", "parcel", "permit"],
      isActive: true,
      notes: "Records from Feb 2022+. Pre-2022 migrated from legacy system.",
    },
    {
      name: "City of Bellingham",
      jurisdiction: "Bellingham, WA",
      jurisdictionType: "city",
      countyId: whatcom.id,
      portalUrl: "https://permits.cob.org/etrakit/",
      searchUrl: "https://permits.cob.org/etrakit/Search/permit.aspx",
      platform: "eTRAKiT",
      phone: null,
      email: "permits@cob.org",
      address: null,
      searchableFields: ["address", "name", "permit", "contractor"],
      isActive: true,
      notes: "City limits only. Account required for applications.",
    },
    {
      name: "City of Lynden",
      jurisdiction: "Lynden, WA",
      jurisdictionType: "city",
      countyId: whatcom.id,
      portalUrl: "https://ci-lynden-wa.smartgovcommunity.com/Public/Home",
      searchUrl: "https://ci-lynden-wa.smartgovcommunity.com/Public/Home",
      platform: "SmartGov",
      phone: "360-354-5532",
      email: null,
      address: "300 4th Street, 2nd Floor, Lynden, WA 98264",
      searchableFields: ["address", "name", "permit"],
      isActive: true,
      notes: "Fully digital paperless system since Oct 2025.",
    },
    {
      name: "City of Ferndale",
      jurisdiction: "Ferndale, WA",
      jurisdictionType: "city",
      countyId: whatcom.id,
      portalUrl: "https://ci-ferndale-wa.smartgovcommunity.com/",
      searchUrl: "https://ci-ferndale-wa.smartgovcommunity.com/",
      platform: "SmartGov",
      phone: "360-685-2369",
      email: null,
      address: null,
      searchableFields: ["address", "name", "permit"],
      isActive: true,
      notes: "Building and planning permits available online.",
    },
    {
      name: "Skagit County PDS",
      jurisdiction: "Skagit County (unincorporated)",
      jurisdictionType: "county",
      countyId: skagit.id,
      portalUrl: "https://www.skagitcounty.net/Departments/PlanningAndPermit/permitsearch.htm",
      searchUrl: "https://skagitcountywa.gov/Search/Permits/SearchAdvanced.aspx",
      platform: "Custom / GovPlatform",
      phone: null,
      email: null,
      address: null,
      searchableFields: ["address", "parcel", "name", "permit", "contractor"],
      isActive: true,
      notes: "Advanced search by address, parcel, name, permit #. Filter by type and status.",
    },
    {
      name: "City of Mount Vernon",
      jurisdiction: "Mount Vernon, WA",
      jurisdictionType: "city",
      countyId: skagit.id,
      portalUrl: "https://ci-mountvernon-wa.smartgovcommunity.com/public/documentsview",
      searchUrl: "https://ci-mountvernon-wa.smartgovcommunity.com/public/documentsview",
      platform: "SmartGov",
      phone: "360-336-6214",
      email: "permittech@mountvernonwa.gov",
      address: null,
      searchableFields: ["address", "name", "permit", "contractor"],
      isActive: true,
      notes: "Building, engineering, planning, fire, and flood permits.",
    },
    {
      name: "City of Anacortes",
      jurisdiction: "Anacortes, WA",
      jurisdictionType: "city",
      countyId: skagit.id,
      portalUrl: "https://ci-anacortes-wa.smartgovcommunity.com/Public/Home",
      searchUrl: "https://ci-anacortes-wa.smartgovcommunity.com/Public/Home",
      platform: "SmartGov",
      phone: "360-293-1901",
      email: "pced@anacorteswa.gov",
      address: null,
      searchableFields: ["address", "name", "permit", "parcel"],
      isActive: true,
      notes: "Permits prior to 2000 may not be viewable online.",
    },
    {
      name: "City of Burlington",
      jurisdiction: "Burlington, WA",
      jurisdictionType: "city",
      countyId: skagit.id,
      portalUrl: null,
      searchUrl: null,
      platform: "Contact Required",
      phone: "360-755-0077",
      email: null,
      address: "900 Fairhaven Ave, Burlington, WA 98233",
      searchableFields: ["address"],
      isActive: false,
      notes: "No online portal found. Contact building department directly.",
    },
    {
      name: "Island County Building",
      jurisdiction: "Island County (unincorporated)",
      jurisdictionType: "county",
      countyId: island.id,
      portalUrl: "https://co-island-wa.smartgovcommunity.com/",
      searchUrl: "https://co-island-wa.smartgovcommunity.com/",
      platform: "SmartGov",
      phone: "360-679-7339",
      email: "buildingdept@islandcountywa.gov",
      address: null,
      searchableFields: ["address", "name", "permit"],
      isActive: true,
      notes: "SFR, DADU, accessory, solar, plumbing, mechanical permits online.",
    },
    {
      name: "City of Oak Harbor",
      jurisdiction: "Oak Harbor, WA",
      jurisdictionType: "city",
      countyId: island.id,
      portalUrl: "https://oakharbor.onlama.com/",
      searchUrl: "https://oakharbor.onlama.com/",
      platform: "LAMA",
      phone: "360-279-4510",
      email: null,
      address: "865 SE Barrington Drive, Oak Harbor, WA 98277",
      searchableFields: ["address", "permit"],
      isActive: true,
      notes: "Building, mechanical, plumbing, sign, and demolition permits.",
    },
    {
      name: "Town of Coupeville",
      jurisdiction: "Coupeville, WA",
      jurisdictionType: "city",
      countyId: island.id,
      portalUrl: "https://twn-coupeville-wa.smartgovcommunity.com/Public/Home",
      searchUrl: "https://twn-coupeville-wa.smartgovcommunity.com/Public/Home",
      platform: "SmartGov",
      phone: "360-678-4461",
      email: "permits@townofcoupeville.org",
      address: null,
      searchableFields: ["address", "name", "permit"],
      isActive: true,
      notes: "View applications, inspection results, parcel info.",
    },
    {
      name: "San Juan County Building",
      jurisdiction: "San Juan County",
      jurisdictionType: "county",
      countyId: sanJuan.id,
      portalUrl: "https://co-sanjuan-wa.smartgovcommunity.com/",
      searchUrl: "https://co-sanjuan-wa.smartgovcommunity.com/",
      platform: "SmartGov",
      phone: "360-378-2354",
      email: null,
      address: "135 Rhone Street, Friday Harbor, WA 98250",
      searchableFields: ["address", "name", "permit", "parcel"],
      isActive: true,
      notes: "Desktop only (Chrome/Edge). Monthly reports available.",
    },
  ];

  await db.insert(permitDatabases).values(dbs);
  console.log("Database seeded with Northern WA permit databases.");

  await seedExpandedStates();
  await seedAllCounties();
  await seedAllCities();
}
