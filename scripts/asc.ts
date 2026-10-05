/**
 * App Store Connect API for the ConstructHUB iPhone apps (docs/app/APP-STORE-PLAN.md). Uses the Construct Hub LLC team
 * key kept in ~/.constructhub-keys/asc.json (owner-authorized shared team credential, 2026-10-05) — never committed,
 * never printed.
 *
 * Run: npx tsx scripts/asc.ts <command>
 *   whoami                 apps + bundle IDs the team key can see
 *   ensure-bundle-ids      register us.constructhub.app / us.constructhub.crm (idempotent)
 *   ensure-signing         ConstructHUB's own Apple Distribution certificate (key made here) + an App Store
 *                          profile per app → ~/.constructhub-keys/ios-signing (idempotent; reuses what exists)
 *   get <path>             GET any /v1 path and print the JSON (e.g. "get /v1/apps?limit=5")
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { execFileSync } from "child_process";
import { randomBytes } from "crypto";
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
  } else if (cmd === "ensure-signing") {
    const dir = join(homedir(), ".constructhub-keys", "ios-signing");
    mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
    const state = existsSync(join(dir, "signing.json")) ? JSON.parse(readFileSync(join(dir, "signing.json"), "utf8")) : { profiles: {} };
    // 1. The certificate: a private key generated here; Apple signs the CSR.
    if (!state.certificateId) {
      const key = join(dir, "dist.key"), csr = join(dir, "dist.csr");
      execFileSync("openssl", ["genrsa", "-out", key, "2048"], { stdio: "ignore" }); chmodSync(key, 0o600);
      execFileSync("openssl", ["req", "-new", "-key", key, "-out", csr, "-subj", "/CN=ConstructHUB Distribution/O=Construct Hub LLC/C=US"], { stdio: "ignore" });
      const csrContent = readFileSync(csr, "utf8").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
      const r = await asc("POST", "/v1/certificates", { data: { type: "certificates", attributes: { certificateType: "DISTRIBUTION", csrContent } } });
      writeFileSync(join(dir, "dist.cer"), Buffer.from(r.data.attributes.certificateContent, "base64"));
      execFileSync("openssl", ["x509", "-inform", "DER", "-in", join(dir, "dist.cer"), "-out", join(dir, "dist.pem")]);
      const pass = randomBytes(18).toString("base64url");
      writeFileSync(join(dir, "p12-password.txt"), pass, { mode: 0o600 });
      // Legacy PBE so the macOS keychain on the runner can import it.
      execFileSync("openssl", ["pkcs12", "-export", "-legacy", "-inkey", key, "-in", join(dir, "dist.pem"), "-out", join(dir, "dist.p12"), "-passout", `pass:${pass}`, "-name", "ConstructHUB Distribution"]);
      chmodSync(join(dir, "dist.p12"), 0o600);
      state.certificateId = r.data.id;
      console.log(`certificate created #${r.data.id} (expires ${r.data.attributes.expirationDate?.slice(0, 10)})`);
    } else console.log(`certificate #${state.certificateId}: exists`);
    // 2. An App Store profile per app, tied to that certificate.
    for (const b of BUNDLES) {
      if (state.profiles[b.identifier]) { console.log(`${b.identifier}: profile exists`); continue; }
      const ids = await asc("GET", `/v1/bundleIds?filter[identifier]=${b.identifier}`);
      const bundle = ids.data.find((x: any) => x.attributes.identifier === b.identifier);
      const name = `${b.name} App Store`;
      const r = await asc("POST", "/v1/profiles", { data: { type: "profiles", attributes: { name, profileType: "IOS_APP_STORE" },
        relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } }, certificates: { data: [{ type: "certificates", id: state.certificateId }] } } } });
      writeFileSync(join(dir, `${b.identifier}.mobileprovision`), Buffer.from(r.data.attributes.profileContent, "base64"), { mode: 0o600 });
      state.profiles[b.identifier] = { name, uuid: r.data.attributes.uuid, id: r.data.id };
      console.log(`${b.identifier}: profile "${name}" created`);
    }
    writeFileSync(join(dir, "signing.json"), JSON.stringify(state, null, 1), { mode: 0o600 });
  } else if (cmd === "get" && arg) {
    console.log(JSON.stringify(await asc("GET", arg), null, 1).slice(0, 4000));
  } else {
    console.log("usage: whoami | ensure-bundle-ids | get <path>");
  }
}
if (process.argv[1]?.endsWith("asc.ts")) main().catch((e) => { console.error(e.message); process.exit(1); });
