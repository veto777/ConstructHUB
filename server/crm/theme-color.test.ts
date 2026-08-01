/**
 * Company theme colours (shared/theme-colors.ts) — the org's pick of 20
 * accents, persisted at customFields->>'themeColor'.
 *
 * Three behaviours pinned here:
 *   1. Pure: the palette, resolution (unknown/missing → brand orange), and
 *      the hex → hsl triplet the client sets as --primary verbatim.
 *   2. Server (running dev server): the org PATCH accepts a valid preset id
 *      (merged into custom_fields without clobbering the rest), 400s an
 *      unknown one, and the public estimate payload carries the resolved
 *      theme — hex AND hsl, server-side, so the client never does colour math.
 *   3. PDF: buildContractPdf prints the letterhead company name in the org's
 *      accent hex, falling back to the brand orange.
 *
 * The server-side part uses the dev-bypass session like divisions.test.ts and
 * restores the org's theme to orange in a finally block. Local dev DB only.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash, randomBytes } from "crypto";
import pg from "pg";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

let CRM_THEME_COLORS: any, DEFAULT_THEME_COLOR_ID: string, isThemeColorId: any,
  hexToHslTriplet: any, resolveOrgTheme: any, themePayload: any;
let buildContractPdf: any, pdfAccentHex: any, BRAND_ORANGE: string;

beforeAll(async () => {
  ({ CRM_THEME_COLORS, DEFAULT_THEME_COLOR_ID, isThemeColorId, hexToHslTriplet, resolveOrgTheme, themePayload } =
    await import("@shared/theme-colors"));
  ({ buildContractPdf, pdfAccentHex, BRAND_ORANGE } = await import("./contract-pdf"));
});

// ── Pure: the palette + resolution ──────────────────────────────────────────

describe("theme colour presets", () => {
  it("exactly 20 presets, unique ids, well-formed hex pairs", () => {
    expect(CRM_THEME_COLORS).toHaveLength(20);
    expect(new Set(CRM_THEME_COLORS.map((c: any) => c.id)).size).toBe(20);
    for (const c of CRM_THEME_COLORS) {
      expect(c.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(c.onHex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it("the default is the brand orange #F97316", () => {
    expect(DEFAULT_THEME_COLOR_ID).toBe("orange");
    const d = CRM_THEME_COLORS.find((c: any) => c.id === "orange");
    expect(d.hex).toBe("#F97316");
  });

  it("resolveOrgTheme: missing or unknown ids fall back to orange", () => {
    expect(resolveOrgTheme(null).id).toBe("orange");
    expect(resolveOrgTheme(undefined).id).toBe("orange");
    expect(resolveOrgTheme({}).id).toBe("orange");
    expect(resolveOrgTheme({ themeColor: "chartreuse" }).id).toBe("orange");
    expect(resolveOrgTheme({ themeColor: 42 }).id).toBe("orange");
  });

  it("resolveOrgTheme: a stored id resolves its preset with hsl triplets", () => {
    const t = resolveOrgTheme({ themeColor: "green" });
    expect(t.id).toBe("green");
    expect(t.hex).toBe("#16A34A");
    expect(t.onHex).toBe("#FFFFFF");
    expect(t.hsl).toBe("142 76% 36%");
    expect(t.onHsl).toBe("0 0% 100%");
  });

  it("isThemeColorId accepts presets and nothing else", () => {
    expect(isThemeColorId("gold")).toBe(true);
    expect(isThemeColorId("black")).toBe(true);
    expect(isThemeColorId("not-a-color")).toBe(false);
    expect(isThemeColorId(null)).toBe(false);
    expect(isThemeColorId("GOLD")).toBe(false);
  });

  it("hexToHslTriplet matches the brand values used in index.css", () => {
    expect(hexToHslTriplet("#F97316")).toBe("25 95% 53%"); // the marketing orange
    expect(hexToHslTriplet("#FFFFFF")).toBe("0 0% 100%");
    expect(hexToHslTriplet("#111827")).toBe("221 39% 11%");
    expect(() => hexToHslTriplet("red")).toThrow();
  });

  it("themePayload carries the id plus the resolved hex/hsl pairs", () => {
    const p = themePayload({ themeColor: "navy" });
    expect(p.themeColor).toBe("navy");
    expect(p.theme.hex).toBe("#1E3A8A");
    expect(p.theme.onHex).toBe("#FFFFFF");
    expect(p.theme.hsl).toBe("224 64% 33%");
    expect(p.theme.onHsl).toBe("0 0% 100%");
  });
});

// ── PDF: the letterhead accent ──────────────────────────────────────────────

const PDF_INPUT = {
  branding: { name: "Theme Test Co", licenseNumber: "CBC000000", licenseState: "FL" },
  orgName: "Theme Test Co",
  customer: { displayName: "Mary Homeowner" },
  estimate: {
    number: "E-1", title: "Theme test", subtotalCents: 10_000, discountCents: 0,
    taxCents: 0, totalCents: 10_000,
  },
  items: [], options: [], terms: null,
};

// pdfkit writes fill colours as `<r> <g> <b> sc` under /DeviceRGB.
const rgbOp = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => v / 255;
  return `${f((n >> 16) & 255)} ${f((n >> 8) & 255)} ${f(n & 255)} sc`;
};

describe("contract PDF accent", () => {
  it("pdfAccentHex passes a clean #rrggbb through and falls back otherwise", () => {
    expect(pdfAccentHex("#16A34A")).toBe("#16A34A");
    expect(pdfAccentHex(undefined)).toBe(BRAND_ORANGE);
    expect(pdfAccentHex(null)).toBe(BRAND_ORANGE);
    expect(pdfAccentHex("green")).toBe(BRAND_ORANGE);
    expect(pdfAccentHex("#12345")).toBe(BRAND_ORANGE);
    expect(pdfAccentHex("javascript:alert(1)")).toBe(BRAND_ORANGE);
  });

  it("the letterhead prints in the org's theme hex", async () => {
    const pdf = await buildContractPdf({ ...PDF_INPUT, accentHex: "#16A34A" }, { compress: false });
    const raw = pdf.toString("latin1");
    expect(raw).toContain(rgbOp("#16A34A"));
    expect(raw).not.toContain(rgbOp(BRAND_ORANGE));
  });

  it("no accentHex → the brand orange", async () => {
    const pdf = await buildContractPdf(PDF_INPUT, { compress: false });
    expect(pdf.toString("latin1")).toContain(rgbOp(BRAND_ORANGE));
  });
});

// ── Server: org PATCH + public payload (running dev server) ─────────────────

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

// The seeded second org the e2e suite uses (helpers.ORGS.aspire). The theme
// tests run against THIS org — the other dev-server suites stay on the
// session-default org, so nobody's read-modify-write of the same
// custom_fields jsonb can race anyone else's.
const THEME_TEST_ORG = "b839980a-ad26-44d4-9e83-df427bd60fe8";

describe("org theme over the API (dev server)", () => {
  it("PATCH accepts a preset id, 400s an unknown one, and the public estimate payload carries the resolved theme", async () => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL });
    const run = Date.now().toString(36);
    let cookie: string | undefined;
    try {
      const me = await api("/api/crm/me");
      if (me.status !== 200) throw new Error(`dev server not reachable at ${BASE}`);
      cookie = me.cookie;
      // Pin this suite's session to the second org (the pin is per-session —
      // every other suite keeps its own session and its own org). The switch
      // is what mints the session, so ITS cookie is the one to keep.
      const sw = await api("/api/crm/org/switch", {
        method: "POST", body: JSON.stringify({ orgId: THEME_TEST_ORG }),
      }, cookie);
      expect(sw.status).toBe(200);
      cookie = sw.cookie;

      // Unknown id → 400, and the stored theme is untouched.
      const bad = await api("/api/crm/org", {
        method: "PATCH", body: JSON.stringify({ themeColor: "chartreuse" }),
      }, cookie);
      expect(bad.status).toBe(400);

      // A marker key straight into custom_fields — the theme PATCH must merge,
      // never clobber (the HCP importer shares this jsonb).
      await pool.query(
        `update crm_orgs set custom_fields = coalesce(custom_fields, '{}'::jsonb) || '{"vitestThemeMarker": true}'::jsonb where id = $1`,
        [THEME_TEST_ORG],
      );

      // Valid id → 200, merged into custom_fields. Assertions land on THIS
      // PATCH's own .returning() row — immune to other suites concurrently
      // writing the same column (they hold their own snapshots).
      const good = await api("/api/crm/org", {
        method: "PATCH", body: JSON.stringify({ themeColor: "green" }),
      }, cookie);
      expect(good.status).toBe(200);
      expect((good.body.customFields as any)?.themeColor).toBe("green");
      expect((good.body.customFields as any)?.vitestThemeMarker).toBe(true);
      await pool.query(
        `update crm_orgs set custom_fields = custom_fields - 'vitestThemeMarker' where id = $1`,
        [THEME_TEST_ORG],
      );

      // A throwaway estimate → its public payload carries the resolved theme.
      const cust = await api("/api/crm/customers", {
        method: "POST",
        body: JSON.stringify({ displayName: `Vitest theme ${run}`, email: `vitest.theme.${run}@example.com` }),
      }, cookie);
      expect(cust.status).toBe(201);
      const est = await api("/api/crm/estimates", {
        method: "POST",
        body: JSON.stringify({
          customerId: cust.body.id,
          items: [{ kind: "labor", name: "L", quantityMilli: 1000, unitPriceCents: 1000 }],
        }),
      }, cookie);
      expect(est.status).toBe(201);
      const { rows } = await pool.query(
        `select public_token from crm_estimates where id = $1`, [est.body.id]);

      // The public route is email-gated — open it with a client session for
      // the estimate's customer, minted exactly like the redeem flow does.
      const raw = randomBytes(32).toString("hex");
      await pool.query(
        `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
         values ($1, $2::jsonb, now() + interval '30 days', now())`,
        [createHash("sha256").update(raw).digest("hex"), JSON.stringify([cust.body.id])],
      );
      // Other suites concurrently PATCH this org's custom_fields (read-modify-
      // write of the whole jsonb) and can briefly overwrite the green pick —
      // re-assert it and refetch instead of racing them.
      let pub: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        await api("/api/crm/org", { method: "PATCH", body: JSON.stringify({ themeColor: "green" }) }, cookie);
        pub = await api(`/api/public/estimates/${rows[0].public_token}`, {}, `crm_client=${raw}`);
        if (pub.status === 200 && pub.body.company.themeColor === "green") break;
      }
      expect(pub.status).toBe(200);
      expect(pub.body.company.themeColor).toBe("green");
      expect(pub.body.company.theme).toEqual({
        hex: "#16A34A", onHex: "#FFFFFF", hsl: "142 76% 36%", onHsl: "0 0% 100%",
        // The base (band) colour the accent pairs with — black unless the org
        // chose white (customFields.themeBase).
        base: "black", baseHex: "#111827", onBaseHex: "#F9FAFB",
      });
    } finally {
      // Restore the default orange whatever happened above — on THIS suite's
      // session (still pinned to the test org), not a fresh one.
      if (cookie) {
        await api("/api/crm/org", { method: "PATCH", body: JSON.stringify({ themeColor: "orange" }) }, cookie).catch(() => {});
      }
      await pool.end().catch(() => {});
    }
  });
});
