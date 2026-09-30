import { db, pool } from "./db";
import { ensureStateGuidesSchema } from "./state-guides-schema";
import { stateGuides, stateGuideSteps, masterClassModules, betaAccessCodes } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

function loadJson(filename: string) {
  const filePath = join(import.meta.dirname || __dirname, "data", filename);
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/**
 * Agency links in state-guides.json are re-checked by scripts/verify-state-guides.ts
 * (verified / unconfirmed / dead -> null / none). Each boot copies the four URLs and
 * their check status onto the existing rows, only where something differs, so fixed
 * links reach databases that were seeded earlier (production included).
 * The status columns (read by master-class.tsx) come from ensureStateGuidesSchema,
 * which seedReferenceData runs first.
 */
async function syncStateGuideLinks(guidesData: any[]) {
  const rows = guidesData.map((g: any) => ({
    state_code: g.state_code,
    sos_url: g.sos_url ?? null,
    licensing_board_url: g.licensing_board_url ?? null,
    workers_comp_url: g.workers_comp_url ?? null,
    tax_board_url: g.tax_board_url ?? null,
    sos_url_status: g.sos_url_status ?? null,
    licensing_board_url_status: g.licensing_board_url_status ?? null,
    workers_comp_url_status: g.workers_comp_url_status ?? null,
    tax_board_url_status: g.tax_board_url_status ?? null,
    links_checked_at: g.links_checked_at ?? null,
  }));
  // sos_url is nullable (ensureStateGuidesSchema), so a Secretary of State link found dead
  // is cleared like the other three instead of being kept behind its "dead" status.
  const result = await db.execute(sql`UPDATE state_guides g SET
      sos_url = j.sos_url,
      licensing_board_url = j.licensing_board_url,
      workers_comp_url = j.workers_comp_url,
      tax_board_url = j.tax_board_url,
      sos_url_status = j.sos_url_status,
      licensing_board_url_status = j.licensing_board_url_status,
      workers_comp_url_status = j.workers_comp_url_status,
      tax_board_url_status = j.tax_board_url_status,
      links_checked_at = j.links_checked_at
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS j(
      state_code text, sos_url text, licensing_board_url text, workers_comp_url text, tax_board_url text,
      sos_url_status text, licensing_board_url_status text, workers_comp_url_status text, tax_board_url_status text,
      links_checked_at text)
    WHERE g.state_code = j.state_code AND (
      g.sos_url IS DISTINCT FROM j.sos_url
      OR g.licensing_board_url IS DISTINCT FROM j.licensing_board_url
      OR g.workers_comp_url IS DISTINCT FROM j.workers_comp_url
      OR g.tax_board_url IS DISTINCT FROM j.tax_board_url
      OR g.sos_url_status IS DISTINCT FROM j.sos_url_status
      OR g.licensing_board_url_status IS DISTINCT FROM j.licensing_board_url_status
      OR g.workers_comp_url_status IS DISTINCT FROM j.workers_comp_url_status
      OR g.tax_board_url_status IS DISTINCT FROM j.tax_board_url_status
      OR g.links_checked_at IS DISTINCT FROM j.links_checked_at)`);
  if (result.rowCount) console.log(`Updated agency links on ${result.rowCount} state guide(s) from state-guides.json.`);
}

export async function seedReferenceData() {
  // First, before any drizzle query on stateGuides: its select and insert name the link-status
  // columns, so a database without them (production included) would fail the seed insert and
  // /api/state-guides. Boot runs this seeder before the routes are registered.
  await ensureStateGuidesSchema(pool);

  const guideCount = await db.execute(sql`SELECT COUNT(*) as count FROM state_guides`);
  const totalGuides = Number(guideCount.rows[0].count);

  if (totalGuides === 0) {
    console.log("Seeding state guides...");
    const guidesData = loadJson("state-guides.json");
    const batchSize = 10;
    for (let i = 0; i < guidesData.length; i += batchSize) {
      await db.insert(stateGuides).values(
        guidesData.slice(i, i + batchSize).map((g: any) => ({
          stateCode: g.state_code,
          stateName: g.state_name,
          sosName: g.sos_name,
          sosUrl: g.sos_url ?? null,
          sosUrlStatus: g.sos_url_status ?? null,
          entityTypes: g.entity_types,
          licensingBoardName: g.licensing_board_name,
          licensingBoardUrl: g.licensing_board_url,
          licensingBoardUrlStatus: g.licensing_board_url_status ?? null,
          licensingRequired: g.licensing_required,
          licensingNotes: g.licensing_notes,
          workersCompType: g.workers_comp_type,
          workersCompAgency: g.workers_comp_agency,
          workersCompUrl: g.workers_comp_url,
          workersCompUrlStatus: g.workers_comp_url_status ?? null,
          taxBoardName: g.tax_board_name,
          taxBoardUrl: g.tax_board_url,
          taxBoardUrlStatus: g.tax_board_url_status ?? null,
          linksCheckedAt: g.links_checked_at ?? null,
          salesTaxOnLabor: g.sales_tax_on_labor,
          bAndOTax: g.b_and_o_tax,
          bondRequired: g.bond_required,
          gcBondAmount: g.gc_bond_amount,
          specialtyBondAmount: g.specialty_bond_amount,
          insuranceNotes: g.insurance_notes,
          payrollNotes: g.payroll_notes,
          overview: g.overview,
        }))
      );
    }
    console.log(`Seeded ${guidesData.length} state guides.`);
  } else {
    console.log(`Already have ${totalGuides} state guides.`);
  }
  try {
    await syncStateGuideLinks(loadJson("state-guides.json"));
  } catch (err: any) {
    console.error("State guide link sync failed (will retry on next boot):", err?.message || err);
  }

  const stepCount = await db.execute(sql`SELECT COUNT(*) as count FROM state_guide_steps`);
  const totalSteps = Number(stepCount.rows[0].count);

  if (totalSteps === 0 && totalGuides > 0) {
    console.log("Seeding state guide steps...");
    const stepsData = loadJson("state-guide-steps.json");

    const allGuides = await db.select({ id: stateGuides.id, stateCode: stateGuides.stateCode }).from(stateGuides);
    const guideIdByOldId: Map<number, number> = new Map();

    const oldGuideIds = [...new Set(stepsData.map((s: any) => s.state_guide_id))].sort((a: any, b: any) => a - b) as number[];
    const guidesOrderedByCode = allGuides.sort((a, b) => a.stateCode.localeCompare(b.stateCode));

    const oldIdToStateCode: Record<number, string> = {};
    const stateCodesInOrder = guidesOrderedByCode.map(g => g.stateCode);
    
    for (const step of stepsData) {
      const matchingGuide = allGuides.find(g => g.id === step.state_guide_id);
      if (matchingGuide) {
        guideIdByOldId.set(step.state_guide_id, matchingGuide.id);
      }
    }

    if (guideIdByOldId.size === 0) {
      const uniqueOldIds = [...new Set(stepsData.map((s: any) => s.state_guide_id))] as number[];
      for (const oldId of uniqueOldIds) {
        const match = allGuides.find(g => g.id === oldId);
        if (match) guideIdByOldId.set(oldId, match.id);
      }
    }

    for (const step of stepsData) {
      const guideId = guideIdByOldId.get(step.state_guide_id) || step.state_guide_id;
      await db.insert(stateGuideSteps).values({
        stateGuideId: guideId,
        stepNumber: step.step_number,
        title: step.title,
        description: step.description,
        url: step.url,
        urlLabel: step.url_label,
        category: step.category,
        isRequired: step.is_required,
        tips: step.tips,
      });
    }
    console.log(`Seeded ${stepsData.length} state guide steps.`);
  } else {
    console.log(`Already have ${totalSteps} state guide steps.`);
  }

  const moduleCount = await db.execute(sql`SELECT COUNT(*) as count FROM master_class_modules`);
  const totalModules = Number(moduleCount.rows[0].count);

  if (totalModules === 0) {
    console.log("Seeding master class modules...");
    const modulesData = loadJson("master-class-modules.json");
    for (const m of modulesData) {
      await db.insert(masterClassModules).values({
        title: m.title,
        description: m.description,
        price: m.price,
        category: m.category,
        sortOrder: m.sort_order,
        isActive: m.is_active,
        features: m.features,
      });
    }
    console.log(`Seeded ${modulesData.length} master class modules.`);
  } else {
    console.log(`Already have ${totalModules} master class modules.`);
  }

  const trialCodes = [
    { code: "TRIAL-C9D6AC01", trialDays: 0 },
    { code: "TRIAL-1B3A33E0", trialDays: 7 },
    { code: "TRIAL-3F2D294B", trialDays: 7 },
    { code: "TRIAL-0D439C64", trialDays: 2 },
    { code: "BETA-43EE53CC", trialDays: 2 },
  ];

  for (const tc of trialCodes) {
    const existing = await db.select().from(betaAccessCodes).where(eq(betaAccessCodes.code, tc.code)).limit(1);
    if (existing.length === 0) {
      await db.insert(betaAccessCodes).values({
        code: tc.code,
        createdByUserId: 1,
        expiresAt: tc.trialDays === 0 ? new Date("2099-12-31T23:59:59Z") : new Date(Date.now() + tc.trialDays * 24 * 60 * 60 * 1000),
        trialDays: tc.trialDays,
        recipientEmail: null,
        recipientName: null,
        redeemedByUserId: null,
        redeemedAt: null,
        revoked: false,
        revokedAt: null,
      });
      console.log(`Seeded trial code: ${tc.code} (${tc.trialDays === 0 ? "unlimited" : tc.trialDays + " days"})`);
    }
  }
}
