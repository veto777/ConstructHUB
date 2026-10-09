/**
 * Regenerate docs/pricing/PLAN-MATRIX.md from shared/plan-matrix.ts — the
 * comparison tables' single source (shared with /pricing itself). The doc is
 * generated, never edited by hand; run it after any price-book change:
 *
 *   npm run pricing:matrix
 */
import fs from "fs";
import path from "path";
import {
  businessToolsMatrix, businessToolsColumns, crmMatrixRows, crmMatrixColumns,
  UNLIMITED_CELL, type PlanMatrixCell, type PlanMatrixColumn, type CrmMatrixColumn,
} from "../shared/plan-matrix";
import { ADDONS, PLANS, CALL_ASSISTANT_TIERS, ANNUAL_MONTHS } from "../shared/plans";
import { CRM_PLANS, CRM_ADDONS, CRM_EXTRA_SEAT_MONTHLY_CENTS, CRM_EXTRA_SEAT_ANNUAL_CENTS } from "../shared/crm-plans";
import { PLATFORM_ADDONS, formatUsd } from "../shared/plan-copy";

const usd = formatUsd;

/** One cell as markdown: ✅ ❌ 🟣 Unlimited 🕒 Coming, or the value as text. */
function mdCell(value: PlanMatrixCell): string {
  if (value === true) return "✅";
  if (value === false) return "❌";
  // "unlimited" and a raw -1 that skipped conversion both read as the pill — never the text "-1".
  if (value === UNLIMITED_CELL || value === -1) return "🟣 Unlimited";
  if (typeof value === "object") return "🕒 Coming";
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}

function businessHeader(c: PlanMatrixColumn): string {
  const hero = c.hero ? " ⭐" : "";
  return `**${c.name}**${hero}<br>${usd(c.monthlyCents)}/mo · ${usd(c.annualCents)}/yr<br><sup>${c.tagline}</sup>`;
}

function crmHeader(c: CrmMatrixColumn): string {
  const hero = c.hero ? " ⭐" : "";
  return `**${c.name}**${hero}<br>${usd(c.monthlyCents)}/mo · ${usd(c.annualCents)}/yr<br><sup>${c.tagline}</sup>`;
}

function table(headers: string[], body: string[][]): string {
  const cols = headers.length;
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ];
  return lines.join("\n");
}

function businessTable(): string {
  const columns = businessToolsColumns();
  const sections = businessToolsMatrix();
  const rows: string[][] = [];
  for (const section of sections) {
    rows.push([`**${section.title}**`, ...columns.map(() => "")]);
    for (const r of section.rows) {
      const note = r.note ? `<br><sup>${r.note}</sup>` : "";
      const coming = r.coming ? " 🕒" : "";
      rows.push([`${r.label}${coming}${note}`, ...columns.map((c) => mdCell(r.cells[c.key]))]);
    }
  }
  return table(["Feature", ...columns.map(businessHeader)], rows);
}

function crmTable(): string {
  const columns = crmMatrixColumns();
  const rows = crmMatrixRows().map((r) => {
    const note = r.note ? `<br><sup>${r.note}</sup>` : "";
    const coming = r.coming ? " 🕒" : "";
    return [`${r.label}${coming}${note}`, ...columns.map((c) => mdCell(r.cells[c.key]))];
  });
  return table(["Feature", ...columns.map(crmHeader)], rows);
}

function addonsList(): string {
  const lines = PLATFORM_ADDONS.map((a) => {
    const setup = a.setupCents ? ` + ${usd(a.setupCents)} setup` : "";
    const on = a.availableOn.map((k) => PLANS[k].name).join(", ");
    return `- **${a.name}** — ${usd(a.monthlyCents)}/mo or ${usd(a.annualCents)}/yr${setup} — on: ${on}`;
  });
  lines.push(`- **Extra CRM seat** — ${usd(CRM_EXTRA_SEAT_MONTHLY_CENTS)}/mo or ${usd(CRM_EXTRA_SEAT_ANNUAL_CENTS)}/yr — on: CRM plans (self-serve up to 50)`);
  lines.push(`- **${CRM_ADDONS.jobcam.name}** — ${usd(CRM_ADDONS.jobcam.monthlyCents)}/mo or ${usd(CRM_ADDONS.jobcam.annualCents)}/yr — on: ${CRM_ADDONS.jobcam.availableOn.map((k) => CRM_PLANS[k].name).join(", ")}`);
  // The AI Call Assistant's lines are its own subscription's, listed with the service (never platform add-ons).
  for (const t of CALL_ASSISTANT_TIERS) {
    const addon = ADDONS[t.addon];
    lines.push(`- **${addon.name}** — ${usd(t.monthlyCents)}/mo or ${usd(t.annualCents)}/yr — the AI Call Assistant's own subscription (not a platform add-on)`);
  }
  return lines.join("\n");
}

const generated = new Date().toISOString().slice(0, 10);
const doc = `# Plan matrix

_generated from \`shared/plan-matrix.ts\` on ${generated} — do not edit by hand. Regenerate with \`npm run pricing:matrix\` after any price-book change (shared/plans.ts, shared/crm-plans.ts). See docs/pricing/README.md._

Money is in US dollars. Yearly platform billing is ${ANNUAL_MONTHS}× the monthly price (${12 - ANNUAL_MONTHS} ${12 - ANNUAL_MONTHS === 1 ? "month" : "months"} free); CRM yearly prices are their own. "🕒 Coming" marks a row or module that is promised on the plan but not live yet (shared/plans.ts \`COMING_MODULES\`). ⭐ = the hero plan. There is no per-location pricing and no extra-location add-on: outgrow a plan and you move up.

## Business Tools (the ConstructHUB platform)

${businessTable()}

## CRM (Customer Relations Management) — a separate product

${crmTable()}

## Add-ons

${addonsList()}
`;

const out = path.resolve(import.meta.dirname, "../docs/pricing/PLAN-MATRIX.md");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, doc);
console.log(`wrote ${out} (${doc.split("\n").length} lines)`);
