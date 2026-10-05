/**
 * App Store Connect API for the ConstructHUB iPhone apps (docs/app/APP-STORE-PLAN.md). Uses the Construct Hub LLC team
 * key kept in ~/.constructhub-keys/asc.json (owner-authorized shared team credential, 2026-10-05) — never committed,
 * never printed.
 *
 * Run: npx tsx scripts/asc.ts <command>
 *   whoami                 apps + bundle IDs the team key can see
 *   ensure-bundle-ids      register us.constructhub.app / us.constructhub.crm (idempotent)
 *   get <path>             GET any /v1 path and print the JSON (e.g. "get /v1/apps?limit=5")
 */
import { readFileSync } from "fs";
import { createSign } from "crypto";
import { homedir } from "os";
import { join } from "path";

const cfg = JSON.parse(readFileSync(join(homedir(), ".constructhub-keys", "asc.json"), "utf8"));
const BUNDLES = [
  { identifier: "us.constructhub.app", name: "ConstructHUB" },
  { identifier: "us.constructhub.crm", name: "ConstructHUB CRM" },
];

function token(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: "ES256", kid: cfg.ascKeyId, typ: "JWT" })}.${b64({ iss: cfg.ascIssuerId, iat: now, exp: now + 900, aud: "appstoreconnect-v1" })}`;
  const sig = createSign("SHA256").update(data).sign({ key: readFileSync(cfg.ascKeyFile, "utf8"), dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${data}.${sig}`;
}

export async function asc(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method, headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}: ${json?.errors?.map((e: any) => e.detail || e.title).join("; ")}`), { status: res.status, json });
  return json;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "whoami") {
    const apps = await asc("GET", "/v1/apps?limit=50&fields[apps]=name,bundleId,sku");
    console.log("apps:", apps.data.map((a: any) => `${a.attributes.name} (${a.attributes.bundleId}) #${a.id}`));
    const ids = await asc("GET", "/v1/bundleIds?limit=200&fields[bundleIds]=identifier,name,platform");
    console.log("bundle ids:", ids.data.map((b: any) => b.attributes.identifier));
  } else if (cmd === "ensure-bundle-ids") {
    const ids = await asc("GET", "/v1/bundleIds?limit=200&fields[bundleIds]=identifier");
    const have = new Set(ids.data.map((b: any) => b.attributes.identifier));
    for (const b of BUNDLES) {
      if (have.has(b.identifier)) { console.log(`${b.identifier}: already registered`); continue; }
      const r = await asc("POST", "/v1/bundleIds", { data: { type: "bundleIds", attributes: { identifier: b.identifier, name: b.name, platform: "IOS" } } });
      console.log(`${b.identifier}: registered #${r.data.id}`);
    }
  } else if (cmd === "get" && arg) {
    console.log(JSON.stringify(await asc("GET", arg), null, 1).slice(0, 4000));
  } else {
    console.log("usage: whoami | ensure-bundle-ids | get <path>");
  }
}
if (process.argv[1]?.endsWith("asc.ts")) main().catch((e) => { console.error(e.message); process.exit(1); });
