import { db } from "./db";
import { stateGuides, stateGuideSteps, masterClassModules, betaAccessCodes } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

function loadJson(filename: string) {
  const filePath = join(import.meta.dirname || __dirname, "data", filename);
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export async function seedReferenceData() {
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
          sosUrl: g.sos_url,
          entityTypes: g.entity_types,
          licensingBoardName: g.licensing_board_name,
          licensingBoardUrl: g.licensing_board_url,
          licensingRequired: g.licensing_required,
          licensingNotes: g.licensing_notes,
          workersCompType: g.workers_comp_type,
          workersCompAgency: g.workers_comp_agency,
          workersCompUrl: g.workers_comp_url,
          taxBoardName: g.tax_board_name,
          taxBoardUrl: g.tax_board_url,
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
