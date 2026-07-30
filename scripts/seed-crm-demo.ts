/**
 * Demo seed for the CRM: a believable, living workspace for "Aspire Interiors"
 * (Sarasota, FL) — team, clients, a pipeline with deals in every stage, a
 * flooring/interiors price book, estimates (one approved), invoices (one paid,
 * one open) and enough production data (budget, costs, punch list, daily log)
 * that every page has something real to show.
 *
 * Idempotent: every row is keyed on a natural unique value (email, SKU, code,
 * document number). Running it twice changes nothing.
 *
 * Run:
 *   DATABASE_URL="postgres://…" npx tsx scripts/seed-crm-demo.ts
 */
import { randomBytes } from "crypto";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const { db } = await import("../server/db");
const s = await import("../shared/schema");
const { and, eq, sql } = await import("drizzle-orm");

const tok = () => randomBytes(24).toString("hex");
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400000);

async function main() {
  // ── Owner account + org ───────────────────────────────────────────────────
  // Attach to the first existing user (the dev-bypass user locally, the real
  // owner in any other environment). Never invent a login here.
  const [owner] = await db.select().from(s.users).orderBy(s.users.id).limit(1);
  if (!owner) throw new Error("No users exist yet — sign up (or enable DEV_AUTH_BYPASS_USER1 and hit /api/crm/me) first.");

  let [org] = await db.select().from(s.crmOrgs).where(eq(s.crmOrgs.name, "Aspire Interiors")).limit(1);
  if (!org) {
    [org] = await db.insert(s.crmOrgs).values({
      name: "Aspire Interiors", ownerUserId: owner.id, email: owner.email,
    }).returning();
    console.log("created org Aspire Interiors");
  }
  await db.update(s.crmOrgs).set({
    legalEntityName: "Aspire Interiors LLC",
    email: "office@aspireinteriors.co", phone: "(941) 555-0107",
    website: "https://aspireinteriors.example.com",
    addressLine1: "1847 Main Street", city: "Sarasota", state: "FL", postalCode: "34236",
    licenseNumber: "CBC1264418", licenseState: "FL",
    industry: "Flooring & Interior Remodeling",
    description: "Full-service flooring and interior remodeling across Sarasota and Manatee counties.",
    estimateFooter: "Thank you for considering Aspire Interiors.",
    invoiceFooter: "Thank you for your business.",
    termsAndConditions: "Payment due as stated. Workmanship warranted for 2 years. Materials per manufacturer warranty.",
    warrantyText: "Aspire Interiors warrants labor for 24 months from substantial completion.",
    defaultDepositBps: 3000,
    onboardingDismissedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(s.crmOrgs.id, org.id));
  const orgId = org.id;

  // Seats for the demo team (local/demo only — real plans come from Stripe).
  const [sub] = await db.select().from(s.subscriptions)
    .where(eq(s.subscriptions.userId, org.ownerUserId)).limit(1);
  if (!sub) {
    await db.insert(s.subscriptions)
      .values({ userId: org.ownerUserId, plan: "platinum", status: "active" });
  } else if (sub.plan !== "platinum" || sub.status !== "active") {
    await db.update(s.subscriptions).set({ plan: "platinum", status: "active" })
      .where(eq(s.subscriptions.id, sub.id));
  }

  // ── Team ──────────────────────────────────────────────────────────────────
  async function ensureMember(m: {
    email: string; role: string; displayName: string; title?: string;
    phone?: string; userId?: number | null; hourlyCostCents?: number;
  }) {
    const [row] = await db.select().from(s.crmMembers)
      .where(and(eq(s.crmMembers.orgId, orgId), sql`lower(${s.crmMembers.email}) = ${m.email}`)).limit(1);
    if (row) return row;
    return (await db.insert(s.crmMembers).values({
      orgId, userId: m.userId ?? null, email: m.email, role: m.role, status: "active",
      displayName: m.displayName, title: m.title ?? null, phone: m.phone ?? null,
      hourlyCostCents: m.hourlyCostCents ?? null,
    } as any).returning())[0];
  }

  const ownerMember = await ensureMember({
    email: (owner.email ?? "owner@aspireinteriors.co").toLowerCase(),
    role: "owner", displayName: owner.displayName ?? "Alex Rivera",
    title: "Owner", phone: "(941) 555-0107", userId: owner.id, hourlyCostCents: 0,
  });
  // The onboarding checklist needs the owner's profile complete.
  await db.update(s.crmMembers).set({
    displayName: ownerMember.displayName ?? (owner.displayName || "Alex Rivera"),
    phone: ownerMember.phone ?? "(941) 555-0107",
    title: ownerMember.title ?? "Owner",
    updatedAt: new Date(),
  }).where(eq(s.crmMembers.id, ownerMember.id));
  const rita = await ensureMember({
    email: "rita@aspireinteriors.co", role: "office", displayName: "Rita Santos",
    title: "Office Manager", phone: "(941) 555-0112",
  });
  const marco = await ensureMember({
    email: "marco@aspireinteriors.co", role: "field", displayName: "Marco Delgado",
    title: "Lead Installer", phone: "(941) 555-0123", hourlyCostCents: 3200,
  });
  const dee = await ensureMember({
    email: "dee@aspireinteriors.co", role: "field", displayName: "Dee Okafor",
    title: "Finish Carpenter", phone: "(941) 555-0131", hourlyCostCents: 3600,
  });

  // ── Lead sources + cost codes ─────────────────────────────────────────────
  async function ensureLeadSource(name: string) {
    const [row] = await db.select().from(s.crmLeadSources)
      .where(and(eq(s.crmLeadSources.orgId, orgId), eq(s.crmLeadSources.name, name))).limit(1);
    if (row) return row;
    return (await db.insert(s.crmLeadSources).values({ orgId, name }).returning())[0];
  }
  const referral = await ensureLeadSource("Referral");
  await ensureLeadSource("Google Local Services");
  await ensureLeadSource("Houzz");
  await ensureLeadSource("Yard sign");

  const COST_CODES: [string, string, string][] = [
    ["01-000", "General Conditions", "01 General"],
    ["01-500", "Permits & Fees", "01 General"],
    ["06-200", "Finish Carpentry", "06 Wood & Plastics"],
    ["09-300", "Flooring", "09 Finishes"],
    ["09-310", "Tile", "09 Finishes"],
    ["09-900", "Painting", "09 Finishes"],
  ];
  const costCodeByCode = new Map<string, string>();
  for (const [code, name, division] of COST_CODES) {
    const [existing] = await db.select().from(s.crmCostCodes)
      .where(and(eq(s.crmCostCodes.orgId, orgId), eq(s.crmCostCodes.code, code))).limit(1);
    if (existing) { costCodeByCode.set(code, existing.id); continue; }
    const [row] = await db.insert(s.crmCostCodes).values({ orgId, code, name, division } as any).returning();
    costCodeByCode.set(code, row.id);
  }

  // ── Price book ────────────────────────────────────────────────────────────
  async function ensureCategory(name: string, sortOrder: number) {
    const [row] = await db.select().from(s.crmPbCategories)
      .where(and(eq(s.crmPbCategories.orgId, orgId), eq(s.crmPbCategories.name, name))).limit(1);
    if (row) return row;
    return (await db.insert(s.crmPbCategories).values({ orgId, name, sortOrder } as any).returning())[0];
  }
  const catFloor = await ensureCategory("Flooring", 1);
  const catKitchen = await ensureCategory("Kitchen & Bath", 2);
  const catPaint = await ensureCategory("Painting", 3);

  async function ensureLabor(name: string, cost: number, price: number, isDefault = false) {
    const [row] = await db.select().from(s.crmPbLaborRates)
      .where(and(eq(s.crmPbLaborRates.orgId, orgId), eq(s.crmPbLaborRates.name, name))).limit(1);
    if (row) return row;
    return (await db.insert(s.crmPbLaborRates).values({
      orgId, name, hourlyCostCents: cost, hourlyPriceCents: price, isDefault,
    } as any).returning())[0];
  }
  const installCrew = await ensureLabor("Install crew", 3200, 7500, true);
  const finishCarp = await ensureLabor("Finish carpenter", 3600, 8500);
  const painter = await ensureLabor("Painter", 2800, 6500);

  async function ensureMaterial(m: {
    name: string; sku: string; categoryId: string; unit: string;
    cost: number; price: number; waste: number; supplier?: string;
  }) {
    const [row] = await db.select().from(s.crmPbMaterials)
      .where(and(eq(s.crmPbMaterials.orgId, orgId), eq(s.crmPbMaterials.sku, m.sku))).limit(1);
    if (row) return row;
    return (await db.insert(s.crmPbMaterials).values({
      orgId, categoryId: m.categoryId, name: m.name, sku: m.sku, unit: m.unit,
      costCents: m.cost, priceCents: m.price, wasteFactorBps: m.waste,
      supplier: m.supplier ?? null, taxable: true,
    } as any).returning())[0];
  }
  const whiteOak = await ensureMaterial({
    name: "White oak engineered hardwood, 7.5\" plank", sku: "WO-ENG-75", categoryId: catFloor.id,
    unit: "sf", cost: 625, price: 1095, waste: 800, supplier: "ProSource",
  });
  const lvp = await ensureMaterial({
    name: "Luxury vinyl plank, 20mil wear layer", sku: "LVP-20M", categoryId: catFloor.id,
    unit: "sf", cost: 310, price: 649, waste: 700, supplier: "Floor & Decor",
  });
  const underlay = await ensureMaterial({
    name: "Acoustic underlayment", sku: "UND-ACU", categoryId: catFloor.id,
    unit: "sf", cost: 55, price: 120, waste: 500,
  });
  const baseboard = await ensureMaterial({
    name: "Baseboard, 5.25\" primed", sku: "BB-525", categoryId: catFloor.id,
    unit: "lf", cost: 190, price: 425, waste: 1000, supplier: "84 Lumber",
  });
  const subwayTile = await ensureMaterial({
    name: "Subway tile, 3x12 handmade-look", sku: "TL-SUB312", categoryId: catKitchen.id,
    unit: "sf", cost: 780, price: 1495, waste: 1200, supplier: "TileBar",
  });
  const thinset = await ensureMaterial({
    name: "Thinset & grout kit (per 40 sf)", sku: "TL-SET40", categoryId: catKitchen.id,
    unit: "ea", cost: 4200, price: 7800, waste: 0,
  });
  const cabinetPaint = await ensureMaterial({
    name: "Cabinet enamel, 2-part (per gal)", sku: "PT-CAB1G", categoryId: catPaint.id,
    unit: "gal", cost: 6800, price: 11000, waste: 0, supplier: "Sherwin-Williams",
  });

  async function ensureItem(i: {
    code: string; name: string; categoryId: string; unit: string;
    pricingMode: string; description?: string; flatPriceCents?: number;
    parts: { materialId?: string; laborRateId?: string; quantityMilli: number; hoursMilli?: number }[];
  }) {
    const [existing] = await db.select().from(s.crmPbItems)
      .where(and(eq(s.crmPbItems.orgId, orgId), eq(s.crmPbItems.code, i.code))).limit(1);
    if (existing) return existing;
    const [row] = await db.insert(s.crmPbItems).values({
      orgId, categoryId: i.categoryId, code: i.code, name: i.name, unit: i.unit,
      pricingMode: i.pricingMode, description: i.description ?? null,
      flatPriceCents: i.flatPriceCents ?? null, taxable: true,
      costCodeId: costCodeByCode.get("09-300") ?? null,
    } as any).returning();
    if (i.parts.length) {
      await db.insert(s.crmPbItemParts).values(i.parts.map((p, idx) => ({
        orgId, itemId: row.id, sortOrder: idx,
        materialId: p.materialId ?? null, laborRateId: p.laborRateId ?? null,
        quantityMilli: p.quantityMilli, hoursMilli: p.hoursMilli ?? null,
      })) as any);
    }
    return row;
  }

  await ensureItem({
    code: "FLR-WO-INST", name: "Engineered hardwood, supply & install", categoryId: catFloor.id,
    unit: "sf", pricingMode: "computed",
    description: "Glue-assist floating install over acoustic underlayment. Includes 8% waste.",
    parts: [
      { materialId: whiteOak.id, quantityMilli: 1000 },
      { materialId: underlay.id, quantityMilli: 1000 },
      { laborRateId: installCrew.id, quantityMilli: 125, hoursMilli: 125 },
    ],
  });
  await ensureItem({
    code: "FLR-LVP-INST", name: "LVP, supply & install", categoryId: catFloor.id,
    unit: "sf", pricingMode: "computed",
    description: "Click-lock LVP over acoustic underlayment. Includes 7% waste.",
    parts: [
      { materialId: lvp.id, quantityMilli: 1000 },
      { materialId: underlay.id, quantityMilli: 1000 },
      { laborRateId: installCrew.id, quantityMilli: 100, hoursMilli: 100 },
    ],
  });
  await ensureItem({
    code: "BB-INST", name: "Baseboard, supply & install", categoryId: catFloor.id,
    unit: "lf", pricingMode: "computed",
    description: "5.25\" primed base, caulked and painted-ready.",
    parts: [
      { materialId: baseboard.id, quantityMilli: 1000 },
      { laborRateId: finishCarp.id, quantityMilli: 50, hoursMilli: 50 },
    ],
  });
  await ensureItem({
    code: "KB-BACKSPLASH", name: "Kitchen backsplash, supply & install", categoryId: catKitchen.id,
    unit: "sf", pricingMode: "computed",
    description: "3x12 subway, stacked or offset. Includes thinset/grout and 12% waste.",
    parts: [
      { materialId: subwayTile.id, quantityMilli: 1000 },
      { materialId: thinset.id, quantityMilli: 25 },
      { laborRateId: installCrew.id, quantityMilli: 350, hoursMilli: 350 },
    ],
  });
  await ensureItem({
    code: "PT-CABINET", name: "Cabinet refinishing, spray enamel", categoryId: catPaint.id,
    unit: "job", pricingMode: "flat", flatPriceCents: 385000,
    description: "Doors/drawers sprayed off-site, frames in place. Two coats 2-part enamel.",
    parts: [],
  });

  // ── Clients ───────────────────────────────────────────────────────────────
  async function ensureCustomer(c: {
    displayName: string; email: string; phone: string;
    addressLine1: string; city: string; state?: string; postalCode?: string;
    companyName?: string; leadSourceId?: string; tags?: string[];
  }) {
    const [row] = await db.select().from(s.crmCustomers)
      .where(and(eq(s.crmCustomers.orgId, orgId), sql`lower(${s.crmCustomers.email}) = ${c.email}`)).limit(1);
    if (row) return row;
    return (await db.insert(s.crmCustomers).values({
      orgId, displayName: c.displayName, email: c.email, phone: c.phone,
      addressLine1: c.addressLine1, city: c.city, state: c.state ?? "FL",
      postalCode: c.postalCode ?? null, companyName: c.companyName ?? null,
      leadSourceId: c.leadSourceId ?? null, tags: c.tags ?? null,
      ownerMemberId: ownerMember.id, portalToken: tok(),
    } as any).returning())[0];
  }

  const kane = await ensureCustomer({
    displayName: "Joe & Mary Kane", email: "kane@example.com", phone: "(941) 555-0134",
    addressLine1: "412 Palm Ave", city: "Sarasota", postalCode: "34236",
    leadSourceId: referral.id, tags: ["repeat"],
  });
  const whitfield = await ensureCustomer({
    displayName: "Dana Whitfield", email: "dana.whitfield@example.com", phone: "(941) 555-0176",
    addressLine1: "88 Bougainvillea Ct", city: "Osprey", postalCode: "34229",
  });
  const orozco = await ensureCustomer({
    displayName: "Luis Orozco", email: "luis.orozco@example.com", phone: "(941) 555-0149",
    addressLine1: "2210 14th St W", city: "Bradenton", postalCode: "34205",
  });
  const mercer = await ensureCustomer({
    displayName: "The Mercer Group", email: "pm@mercergroup.example.com", phone: "(941) 555-0190",
    addressLine1: "5300 Ocean Blvd", city: "Sarasota", postalCode: "34242",
    companyName: "The Mercer Group", tags: ["commercial"],
  });
  const ellison = await ensureCustomer({
    displayName: "Greta Ellison", email: "greta.ellison@example.com", phone: "(941) 555-0161",
    addressLine1: "17 Heron Way", city: "Venice", postalCode: "34285",
    leadSourceId: referral.id,
  });
  const bauer = await ensureCustomer({
    displayName: "Tom & Priya Bauer", email: "bauers@example.com", phone: "(941) 555-0158",
    addressLine1: "906 Midnight Pass Rd", city: "Sarasota", postalCode: "34242",
  });
  const nguyen = await ensureCustomer({
    displayName: "Lan Nguyen", email: "lan.nguyen@example.com", phone: "(941) 555-0183",
    addressLine1: "332 Grove St", city: "Bradenton", postalCode: "34208",
  });
  const castellano = await ensureCustomer({
    displayName: "Vince Castellano", email: "vince.c@example.com", phone: "(941) 555-0122",
    addressLine1: "75 Spoonbill Ln", city: "Venice", postalCode: "34293",
  });

  // ── Pipeline: a project in every meaningful stage ─────────────────────────
  async function ensureProject(p: {
    number: string; customerId: string; name: string; status: string;
    city: string; trades: string[]; contractValueCents?: number;
    projectManagerMemberId?: string; salesMemberId?: string;
  }) {
    const [row] = await db.select().from(s.crmProjects)
      .where(and(eq(s.crmProjects.orgId, orgId), eq(s.crmProjects.number, p.number))).limit(1);
    if (row) return row;
    return (await db.insert(s.crmProjects).values({
      orgId, customerId: p.customerId, number: p.number, name: p.name, status: p.status,
      city: p.city, state: "FL", trades: p.trades,
      contractValueCents: p.contractValueCents ?? null,
      projectManagerMemberId: p.projectManagerMemberId ?? null,
      salesMemberId: p.salesMemberId ?? null,
      stageChangedAt: daysFromNow(-3),
    } as any).returning())[0];
  }

  const projKane = await ensureProject({
    number: "P-2001", customerId: kane.id, name: "Kane — whole-house hardwood", status: "in_progress",
    city: "Sarasota", trades: ["flooring", "carpentry"], contractValueCents: 4209839,
    projectManagerMemberId: marco.id, salesMemberId: ownerMember.id,
  });
  await ensureProject({
    number: "P-2002", customerId: whitfield.id, name: "Whitfield — kitchen backsplash + floors", status: "lead",
    city: "Osprey", trades: ["tile", "flooring"],
  });
  await ensureProject({
    number: "P-2003", customerId: orozco.id, name: "Orozco — LVP downstairs", status: "estimating",
    city: "Bradenton", trades: ["flooring"], salesMemberId: ownerMember.id,
  });
  await ensureProject({
    number: "P-2004", customerId: mercer.id, name: "Mercer — lobby refresh", status: "proposal_sent",
    city: "Sarasota", trades: ["flooring", "painting"], contractValueCents: 860000,
  });
  const projEllison = await ensureProject({
    number: "P-2005", customerId: ellison.id, name: "Ellison — master suite floors", status: "scheduled",
    city: "Venice", trades: ["flooring"], contractValueCents: 612000,
    projectManagerMemberId: dee.id,
  });
  await ensureProject({
    number: "P-2006", customerId: bauer.id, name: "Bauer — cabinet refinishing", status: "waiting_on_trades",
    city: "Sarasota", trades: ["painting", "carpentry"], contractValueCents: 385000,
    projectManagerMemberId: dee.id,
  });
  const projNguyen = await ensureProject({
    number: "P-2007", customerId: nguyen.id, name: "Nguyen — rental turnover LVP", status: "punch_list",
    city: "Bradenton", trades: ["flooring"], contractValueCents: 498000,
    projectManagerMemberId: marco.id,
  });
  const projCastellano = await ensureProject({
    number: "P-2008", customerId: castellano.id, name: "Castellano — guest bath tile", status: "paid",
    city: "Venice", trades: ["tile"], contractValueCents: 355208,
    projectManagerMemberId: marco.id,
  });

  // ── Estimates (one approved, one open) ────────────────────────────────────
  async function ensureEstimate(e: {
    number: string; customerId: string; projectId?: string; title: string;
    status: string; taxRateBps: number;
    items: { kind: string; name: string; quantityMilli: number; unit?: string; unitPriceCents: number }[];
    sent?: boolean; viewed?: boolean; approved?: boolean; signatureName?: string;
  }) {
    const [existing] = await db.select().from(s.crmEstimates)
      .where(and(eq(s.crmEstimates.orgId, orgId), eq(s.crmEstimates.number, e.number))).limit(1);
    if (existing) return existing;
    const [est] = await db.insert(s.crmEstimates).values({
      orgId, customerId: e.customerId, projectId: e.projectId ?? null,
      number: e.number, title: e.title, status: e.status, taxRateBps: e.taxRateBps,
      publicToken: tok(), createdByMemberId: ownerMember.id,
      introText: "Thanks for having us out — here's the scope we walked through together.",
      sentAt: e.sent ? daysFromNow(-4) : null,
      sentToEmail: e.sent ? "client@example.com" : null,
      firstViewedAt: e.viewed ? daysFromNow(-3) : null,
      lastViewedAt: e.viewed ? daysFromNow(-1) : null,
      viewCount: e.viewed ? 3 : 0,
      approvedAt: e.approved ? daysFromNow(-2) : null,
      signatureName: e.approved ? e.signatureName ?? null : null,
      expiresAt: daysFromNow(26),
      depositCents: null,
    } as any).returning();
    await db.insert(s.crmEstimateItems).values(e.items.map((it, idx) => ({
      orgId, estimateId: est.id, sortOrder: idx, kind: it.kind, name: it.name,
      quantityMilli: it.quantityMilli, unit: it.unit ?? null, unitPriceCents: it.unitPriceCents,
      taxable: true,
    })) as any);
    // Recompute totals the same way the app does.
    const subtotal = e.items.filter((i) => i.kind !== "discount")
      .reduce((sum, i) => sum + Math.round((i.unitPriceCents * i.quantityMilli) / 1000), 0);
    const discount = e.items.filter((i) => i.kind === "discount")
      .reduce((sum, i) => sum + Math.abs(Math.round((i.unitPriceCents * i.quantityMilli) / 1000)), 0);
    const tax = Math.round((Math.max(0, subtotal - discount) * e.taxRateBps) / 10000);
    await db.update(s.crmEstimates).set({
      subtotalCents: subtotal, discountCents: discount, taxCents: tax,
      totalCents: Math.max(0, subtotal - discount + tax),
    }).where(eq(s.crmEstimates.id, est.id));
    const [fresh] = await db.select().from(s.crmEstimates).where(eq(s.crmEstimates.id, est.id)).limit(1);
    return fresh;
  }

  const estKane = await ensureEstimate({
    number: "E-2001", customerId: kane.id, projectId: projKane.id,
    title: "Whole-house engineered hardwood", status: "approved", taxRateBps: 700,
    sent: true, viewed: true, approved: true, signatureName: "Joe Kane",
    items: [
      { kind: "labor", name: "Demolition & disposal of existing carpet/tile", quantityMilli: 1000, unitPriceCents: 285000 },
      { kind: "material", name: "White oak engineered hardwood, 7.5\" plank", quantityMilli: 1680000, unit: "sf", unitPriceCents: 1095 },
      { kind: "material", name: "Acoustic underlayment", quantityMilli: 1680000, unit: "sf", unitPriceCents: 120 },
      { kind: "labor", name: "Install crew — glue-assist floating install", quantityMilli: 210000, unit: "hr", unitPriceCents: 7500 },
      { kind: "material", name: "Baseboard, 5.25\" primed", quantityMilli: 220000, unit: "lf", unitPriceCents: 425 },
      { kind: "discount", name: "Repeat customer", quantityMilli: 1000, unitPriceCents: 150000 },
    ],
  });
  await ensureEstimate({
    number: "E-2002", customerId: orozco.id, projectId: undefined,
    title: "Downstairs LVP", status: "viewed", taxRateBps: 700,
    sent: true, viewed: true,
    items: [
      { kind: "material", name: "Luxury vinyl plank, 20mil wear layer", quantityMilli: 940000, unit: "sf", unitPriceCents: 649 },
      { kind: "material", name: "Acoustic underlayment", quantityMilli: 940000, unit: "sf", unitPriceCents: 120 },
      { kind: "labor", name: "Install crew — click-lock install", quantityMilli: 94000, unit: "hr", unitPriceCents: 7500 },
    ],
  });

  // ── Invoices: one paid, one open ──────────────────────────────────────────
  async function ensureInvoice(i: {
    number: string; customerId: string; projectId?: string; estimateId?: string;
    title: string; status: string; taxRateBps: number;
    items: { kind: string; name: string; quantityMilli: number; unit?: string; unitPriceCents: number }[];
    sent?: boolean; paid?: { amountCents: number; method: string; note?: string };
  }) {
    const [existing] = await db.select().from(s.crmInvoices)
      .where(and(eq(s.crmInvoices.orgId, orgId), eq(s.crmInvoices.number, i.number))).limit(1);
    if (existing) return existing;
    const [inv] = await db.insert(s.crmInvoices).values({
      orgId, customerId: i.customerId, projectId: i.projectId ?? null,
      estimateId: i.estimateId ?? null, number: i.number, title: i.title,
      status: i.status, taxRateBps: i.taxRateBps, publicToken: tok(),
      sentAt: i.sent ? daysFromNow(-2) : null, sentToEmail: i.sent ? "client@example.com" : null,
      dueAt: daysFromNow(28),
    } as any).returning();
    await db.insert(s.crmInvoiceItems).values(i.items.map((it, idx) => ({
      orgId, invoiceId: inv.id, sortOrder: idx, kind: it.kind, name: it.name,
      quantityMilli: it.quantityMilli, unit: it.unit ?? null, unitPriceCents: it.unitPriceCents,
      taxable: true,
    })) as any);
    const subtotal = i.items.filter((x) => x.kind !== "discount")
      .reduce((sum, x) => sum + Math.round((x.unitPriceCents * x.quantityMilli) / 1000), 0);
    const tax = Math.round((subtotal * i.taxRateBps) / 10000);
    const total = subtotal + tax;
    const paidCents = i.paid ? i.paid.amountCents : 0;
    await db.update(s.crmInvoices).set({
      subtotalCents: subtotal, taxCents: tax, totalCents: total,
      paidCents, status: i.paid ? "paid" : i.status,
      paidAt: i.paid ? daysFromNow(-1) : null,
      firstViewedAt: i.sent ? daysFromNow(-1) : null, viewCount: i.sent ? 1 : 0,
    }).where(eq(s.crmInvoices.id, inv.id));
    if (i.paid) {
      await db.insert(s.crmPayments).values({
        orgId, customerId: i.customerId, invoiceId: inv.id, projectId: i.projectId ?? null,
        provider: "manual", purpose: "final", amountCents: i.paid.amountCents,
        method: i.paid.method, status: "succeeded", note: i.paid.note ?? null,
        paidAt: daysFromNow(-1),
      } as any);
    }
    return inv;
  }

  await ensureInvoice({
    number: "INV-2001", customerId: castellano.id, projectId: projCastellano.id,
    title: "Guest bath tile — final", status: "paid", taxRateBps: 700, sent: true,
    paid: { amountCents: 355208, method: "check", note: "Check #2214" },
    items: [
      { kind: "material", name: "Subway tile, 3x12 handmade-look", quantityMilli: 86000, unit: "sf", unitPriceCents: 1495 },
      { kind: "material", name: "Thinset & grout kit", quantityMilli: 3000, unit: "ea", unitPriceCents: 7800 },
      { kind: "labor", name: "Tile setter — 3 days", quantityMilli: 24000, unit: "hr", unitPriceCents: 7500 },
    ],
  });
  await ensureInvoice({
    number: "INV-2002", customerId: kane.id, projectId: projKane.id, estimateId: estKane.id,
    title: "Whole-house hardwood — progress draw 1", status: "sent", taxRateBps: 700, sent: true,
    items: [
      { kind: "labor", name: "Demolition & disposal (complete)", quantityMilli: 1000, unitPriceCents: 285000 },
      { kind: "material", name: "White oak engineered hardwood (50% delivered)", quantityMilli: 840000, unit: "sf", unitPriceCents: 1095 },
      { kind: "material", name: "Acoustic underlayment (50%)", quantityMilli: 840000, unit: "sf", unitPriceCents: 120 },
    ],
  });

  // ── Production data on the Kane job: budget, costs, punch list, log ──────
  const flooringCc = costCodeByCode.get("09-300");
  const gcCc = costCodeByCode.get("01-000");
  if (flooringCc) {
    const hasBudget = await db.select({ id: s.crmBudgetLines.id }).from(s.crmBudgetLines)
      .where(and(eq(s.crmBudgetLines.orgId, orgId), eq(s.crmBudgetLines.projectId, projKane.id))).limit(1);
    if (!hasBudget.length) {
      await db.insert(s.crmBudgetLines).values([
        { orgId, projectId: projKane.id, costCodeId: flooringCc, budgetCents: 2650000, notes: "Materials + install labor" },
        ...(gcCc ? [{ orgId, projectId: projKane.id, costCodeId: gcCc, budgetCents: 285000, notes: "Demo, disposal, protection" }] : []),
      ] as any);
      await db.insert(s.crmCommitments).values({
        orgId, projectId: projKane.id, costCodeId: flooringCc, type: "purchase_order",
        number: "PO-2001", vendorName: "ProSource of Sarasota",
        description: "White oak engineered, 1,814 sf incl. waste", amountCents: 1125000, status: "open",
      } as any);
      await db.insert(s.crmCostEntries).values([
        { orgId, projectId: projKane.id, costCodeId: flooringCc, source: "vendor_bill",
          vendorName: "ProSource of Sarasota", description: "Material drop 1", amountCents: 568000 },
        { orgId, projectId: projKane.id, costCodeId: gcCc ?? flooringCc, source: "labor",
          memberId: marco.id, description: "Demo crew, 2 days", amountCents: 51200, hoursMilli: 16000 },
      ] as any);
      await db.insert(s.crmPunchItems).values([
        { orgId, projectId: projKane.id, title: "Transition strip at hallway tile", location: "Hallway", status: "open", assignedMemberId: marco.id },
        { orgId, projectId: projKane.id, title: "Touch up baseboard paint, master", location: "Master bedroom", status: "open", assignedMemberId: dee.id },
      ] as any);
      await db.insert(s.crmDailyLogs).values({
        orgId, projectId: projKane.id, authorMemberId: marco.id, logDate: daysFromNow(-1),
        weather: "Clear, 84°F", crewCount: 3, hoursMilli: 24000,
        workCompleted: "Finished demo in bedrooms 2-3, started underlayment in great room. Material drop 2 confirmed for Thursday.",
      } as any);
      await db.insert(s.crmAppointments).values([
        { orgId, projectId: projKane.id, customerId: kane.id, title: "Hardwood install — day 3",
          startsAt: daysFromNow(1), endsAt: new Date(daysFromNow(1).getTime() + 8 * 3600000),
          dispatchedMemberIds: [marco.id, dee.id], status: "scheduled" },
        { orgId, projectId: projEllison.id, customerId: ellison.id, title: "Final measure — Ellison",
          startsAt: daysFromNow(3), endsAt: new Date(daysFromNow(3).getTime() + 2 * 3600000),
          dispatchedMemberIds: [dee.id], status: "scheduled" },
      ] as any);
      await db.insert(s.crmChangeOrders).values({
        orgId, projectId: projKane.id, customerId: kane.id, number: "CO-2001",
        title: "Add closet floors (3 closets)", amountCents: 96000, status: "approved",
        publicToken: tok(), sentAt: daysFromNow(-2), approvedAt: daysFromNow(-1),
        signatureName: "Joe Kane",
      } as any);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const counts = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(s.crmMembers).where(eq(s.crmMembers.orgId, orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(s.crmCustomers).where(eq(s.crmCustomers.orgId, orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(s.crmProjects).where(eq(s.crmProjects.orgId, orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(s.crmEstimates).where(eq(s.crmEstimates.orgId, orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(s.crmInvoices).where(eq(s.crmInvoices.orgId, orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(s.crmPbItems).where(eq(s.crmPbItems.orgId, orgId)),
  ]);
  console.log(`✓ Aspire Interiors demo ready: ${counts[0][0].n} team, ${counts[1][0].n} clients, ` +
    `${counts[2][0].n} projects, ${counts[3][0].n} estimates, ${counts[4][0].n} invoices, ${counts[5][0].n} assemblies.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
