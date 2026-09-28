import pg from "pg";

// Auth integration suites reuse the lane's dev identity. Reset only their
// persistent auth counters between runs, never application quotas or data.
export default async function setup() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return;
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || !/^\/constructhub_dev(?:_a\d+)?$/.test(url.pathname)) {
    throw new Error("Integration tests require a local ConstructHUB development database");
  }
  const pool = new pg.Pool({ connectionString: raw });
  try {
    const { rows } = await pool.query("select to_regclass('public.growth_budgets') as table_name");
    if (rows[0].table_name) await pool.query("delete from growth_budgets where key like 'growth-auth:%'");
  } finally { await pool.end(); }
}
