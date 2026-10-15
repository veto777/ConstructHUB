/**
 * Read a table from a public ("publish to web") Power BI report, the way the report's own page does: no login, no
 * key beyond the report's public resource key (in its view?r= link). Used for NJDOL's interactive debarment list,
 * which the department publishes only this way. One model request plus one query per load.
 *
 *   publicPowerBiRows(viewUrl, entity, columns) → rows of { column: value }
 *
 * The query result is Power BI's compressed "DSR" form: per row, `C` holds only the values that are neither repeated
 * from the previous row (bit i of `R`) nor null (bit i of `Ø`); string columns index into ValueDicts.
 */
import { USER_AGENT, politeFetch } from "../../../scrapers/polite-fetch";

type Dsr = { DS: { PH: { DM0?: DsrRow[] }[]; ValueDicts?: Record<string, unknown[]>; RT?: unknown; IC?: boolean }[] };
type DsrRow = { S?: { N: string; T: number; DN?: string }[]; C?: unknown[]; R?: number; "Ø"?: number };

/** Decode the first data set of a querydata result into rows, in column order. */
export function decodeDsr(dsr: Dsr): unknown[][] {
  const ds = dsr.DS?.[0];
  const rows = ds?.PH?.[0]?.DM0 ?? [];
  const schema = rows[0]?.S;
  if (!schema) return [];
  const dicts = ds.ValueDicts ?? {};
  const out: unknown[][] = [];
  let prev: unknown[] = new Array(schema.length).fill(null);
  for (const r of rows) {
    const repeat = r.R ?? 0, nulls = r["Ø"] ?? 0;
    const vals = r.C ?? [];
    let k = 0;
    const cur = schema.map((s, i) => {
      if ((repeat >> i) & 1) return prev[i];
      if ((nulls >> i) & 1) return null;
      const v = vals[k++];
      return s.DN && typeof v === "number" ? dicts[s.DN]?.[v] ?? null : v;
    });
    out.push(cur);
    prev = cur;
  }
  return out;
}

/** The public API host for a report: the page names its cluster's "-redirect" host; queries go to "-api". */
async function apiHost(viewUrl: string): Promise<string> {
  const res = await politeFetch(viewUrl, {}, { minDelayMs: 1500 });
  if (!res.ok) throw new Error(`Power BI report page returned HTTP ${res.status}`);
  const html = await res.text();
  const cluster = html.match(/resolvedClusterUri\s*=\s*'(https:\/\/[^']+)'/)?.[1];
  if (!cluster) throw new Error("Power BI report page did not name its cluster");
  return new URL(cluster.replace("-redirect.", "-api.")).origin;
}

export async function publicPowerBiRows(viewUrl: string, entity: string, columns: string[], max = 30000): Promise<Record<string, unknown>[]> {
  const r = new URL(viewUrl).searchParams.get("r");
  const key = r ? (JSON.parse(Buffer.from(r, "base64").toString("utf8")) as { k?: string }).k : undefined;
  if (!key || !/^[0-9a-f-]{36}$/.test(key)) throw new Error("not a public Power BI report link");
  const host = await apiHost(viewUrl);
  const headers = { "X-PowerBI-ResourceKey": key, "user-agent": USER_AGENT, accept: "application/json" };
  const meta = await politeFetch(`${host}/public/reports/${key}/modelsAndExploration?preferReadOnlySession=true`, { headers }, { minDelayMs: 1500 });
  if (!meta.ok) throw new Error(`Power BI model request returned HTTP ${meta.status}`);
  const modelId = ((await meta.json()) as { models?: { id: number }[] }).models?.[0]?.id;
  if (modelId == null) throw new Error("Power BI report has no model");
  const query = {
    Version: 2,
    From: [{ Name: "t", Entity: entity, Type: 0 }],
    Select: columns.map((c) => ({ Column: { Expression: { SourceRef: { Source: "t" } }, Property: c }, Name: `${entity}.${c}` })),
  };
  const body = {
    version: "1.0.0", cancelQueries: [], modelId,
    queries: [{ QueryId: "", Query: { Commands: [{ SemanticQueryDataShapeCommand: {
      Query: query, Version: 1,
      Binding: { Primary: { Groupings: [{ Projections: columns.map((_, i) => i) }] }, DataReduction: { DataVolume: 3, Primary: { Window: { Count: max } } }, Version: 1 },
    } }] } }],
  };
  const res = await politeFetch(`${host}/public/reports/querydata?synchronous=true`, { method: "POST", body: JSON.stringify(body), headers: { ...headers, "content-type": "application/json" } }, { minDelayMs: 1500 });
  if (!res.ok) throw new Error(`Power BI query returned HTTP ${res.status}`);
  const json = await res.json() as { results?: { result?: { data?: { dsr?: Dsr } } }[] };
  const dsr = json.results?.[0]?.result?.data?.dsr;
  if (!dsr?.DS) throw new Error("Power BI query returned no data");
  if (dsr.DS[0]?.RT) throw new Error(`Power BI table has more than ${max} rows`);
  return decodeDsr(dsr).map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}
