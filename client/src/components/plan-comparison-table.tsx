/**
 * The plan comparison tables on /pricing — both tabs. Every cell comes from
 * shared/plan-matrix.ts (derived from the price book), so the tables cannot
 * drift from checkout: ✅ included, ❌ not included, a purple "Unlimited" pill
 * for any -1 limit, numbers/strings as text, and a "Coming" badge for
 * promised-but-not-live rows and modules (shared/plans.ts COMING_MODULES).
 *
 * Layout: the first column sticks and the table scrolls sideways inside its
 * own rounded frame on narrow screens — the page itself never scrolls
 * sideways (e2e/pricing.spec.ts asserts it at 390px).
 */
import { Check, X } from "lucide-react";
import type { BillingInterval } from "@shared/plans";
import {
  businessToolsMatrix, businessToolsColumns, crmMatrixRows, crmMatrixColumns,
  UNLIMITED_CELL, type PlanMatrixCell, type PlanMatrixColumn, type CrmMatrixColumn,
} from "@shared/plan-matrix";
import { formatUsd, intervalSuffix } from "@/lib/pricing-display";

function UnlimitedPill() {
  return (
    <span className="inline-block rounded-full bg-purple-600 px-2.5 py-1 text-[12px] font-semibold text-white dark:bg-purple-500" data-testid="pill-unlimited">
      Unlimited
    </span>
  );
}

function CellValue({ value }: { value: PlanMatrixCell }) {
  if (value === true)
    return <Check className="w-5 h-5 mx-auto text-green-600 dark:text-green-500" strokeWidth={2.5} aria-label="Included" />;
  if (value === false)
    return <X className="w-5 h-5 mx-auto text-red-600 dark:text-red-500" strokeWidth={2.5} aria-label="Not included" />;
  // "unlimited" AND a raw -1 limit (a cell that skipped the matrix's conversion) render as the
  // pill — a -1 can never show up as the text "-1".
  if (value === UNLIMITED_CELL || value === -1) return <UnlimitedPill />;
  if (typeof value === "object")
    return (
      <span className="inline-block rounded-full border border-dashed border-mkt-rule px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mkt-muted">
        Coming
      </span>
    );
  return (
    <span className="text-[14px] font-medium text-mkt-ink">
      {typeof value === "number" ? value.toLocaleString("en-US") : value}
    </span>
  );
}

function price(column: PlanMatrixColumn | CrmMatrixColumn, interval: BillingInterval): string {
  return `${formatUsd(interval === "year" ? column.annualCents : column.monthlyCents)}${intervalSuffix(interval)}`;
}

function Head({
  columns, interval,
}: { columns: (PlanMatrixColumn | CrmMatrixColumn)[]; interval: BillingInterval }) {
  return (
    <thead>
      <tr className="border-b border-mkt-rule">
        <th scope="col" className="sticky left-0 z-10 min-w-[150px] sm:min-w-[210px] bg-mkt-card p-4 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-muted">
          Feature
        </th>
        {columns.map((c) => (
          <th key={c.key} scope="col" className={`min-w-[104px] p-4 text-center ${c.hero ? "bg-mkt-panel text-mkt-panel-ink" : ""}`}>
            <span className={`block font-display font-semibold text-[1.1rem] ${c.hero ? "text-mkt-panel-ink" : "text-mkt-ink"}`}>{c.name}</span>
            <span className={`block text-[12px] font-medium ${c.hero ? "text-mkt-panel-ink/80" : "text-mkt-muted"}`} data-testid={`text-col-price-${c.key}`}>
              {price(c, interval)}
            </span>
          </th>
        ))}
      </tr>
    </thead>
  );
}

function SectionHeadRow({ title, colCount }: { title: string; colCount: number }) {
  return (
    <tr className="border-b border-mkt-rule bg-mkt-paper-2">
      <th scope="colgroup" colSpan={colCount + 1} className="sticky left-0 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-orange-ink">
        {title}
      </th>
    </tr>
  );
}

function LabelCell({ label, note, coming }: { label: string; note?: string; coming?: true }) {
  return (
    <th scope="row" className="sticky left-0 z-10 bg-mkt-card px-4 py-3 text-left align-middle">
      <span className="block text-[14px] font-medium text-mkt-ink" title={note}>{label}</span>
      {coming && (
        <span className="mt-0.5 inline-block rounded-full border border-dashed border-mkt-rule px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-mkt-muted">
          Coming
        </span>
      )}
    </th>
  );
}

/** The Business Tools tab's table — the five platform plans, Unlimited the hero. */
export function BusinessToolsComparison({ interval }: { interval: BillingInterval }) {
  const sections = businessToolsMatrix();
  const columns = businessToolsColumns();
  return (
    <div className="overflow-x-auto rounded-2xl border border-mkt-rule bg-mkt-card" data-testid="table-plan-comparison">
      <table className="w-full min-w-[720px] text-[14px]">
        <Head columns={columns} interval={interval} />
        <tbody>
          {sections.flatMap((section) => [
            <SectionHeadRow key={`s-${section.title}`} title={section.title} colCount={columns.length} />,
            ...section.rows.map((r) => (
              <tr key={r.key} className="border-b border-dotted border-mkt-rule last:border-b-0" data-testid={`row-compare-${r.key}`}>
                <LabelCell label={r.label} note={r.note} coming={r.coming} />
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 text-center ${c.hero ? "bg-mkt-paper-2/60" : ""}`} data-testid={`cell-compare-${r.key}-${c.key}`}>
                    <CellValue value={r.cells[c.key as keyof typeof r.cells]} />
                  </td>
                ))}
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
}

/** The CRM tab's table — the three CRM plans, CRM Max the hero. */
export function CrmComparison({ interval }: { interval: BillingInterval }) {
  const rows = crmMatrixRows();
  const columns = crmMatrixColumns();
  return (
    <div className="overflow-x-auto rounded-2xl border border-mkt-rule bg-mkt-card" data-testid="table-crm-comparison">
      <table className="w-full min-w-[560px] text-[14px]">
        <Head columns={columns} interval={interval} />
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-dotted border-mkt-rule last:border-b-0" data-testid={`row-compare-${r.key}`}>
              <LabelCell label={r.label} note={r.note} coming={r.coming} />
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 text-center ${c.hero ? "bg-mkt-paper-2/60" : ""}`} data-testid={`cell-compare-${r.key}-${c.key}`}>
                  <CellValue value={r.cells[c.key as keyof typeof r.cells]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
