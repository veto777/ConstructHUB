/**
 * Signing material for the iPhone apps' cloud build, released only to ConstructHUB's own release workflow
 * (docs/app/APP-STORE-PLAN.md). There is no Mac and no GitHub token on the tower, so the GitHub Actions macOS runner
 * proves who it is with GitHub's OIDC token (permissions: id-token: write) and this route checks that proof before
 * handing over the Construct Hub LLC App Store Connect key (owner-authorized shared team key, 2026-10-05).
 *
 *   GET /api/ci/ios-signing   Authorization: Bearer <GitHub OIDC JWT, audience "constructhub-ios-signing">
 *   → { keyId, issuerId, teamId, p8, p12, p12Password, profiles: { bundleId: { name, uuid, content } } }
 *     (base64 files)   404 for anything that isn't exactly that workflow.
 *
 * Checks: RS256 signature against GitHub's published JWKS, iss, aud, exp/nbf/iat, repository + owner, the workflow
 * file (job_workflow_ref) and the ref (main or an ios-v* tag). The key never leaves except over this route.
 * Off unless IOS_SIGNING_DIR (a 700 folder with asc.json + the .p8) is set on the server.
 */
import type { Express, Request, Response } from "express";
import { createPublicKey, verify as verifySig } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

export const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const OIDC_AUDIENCE = "constructhub-ios-signing";
export const ALLOWED_REPO = "veto777/ConstructHUB";
export const ALLOWED_WORKFLOW = "veto777/ConstructHUB/.github/workflows/ios-release.yml@";
const ALLOWED_REF = /^refs\/(heads\/main|tags\/ios-v[0-9][0-9A-Za-z.\-]*)$/;

type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string };
export type JwksFetcher = () => Promise<Jwk[]>;

let jwksCache: { at: number; keys: Jwk[] } | null = null;
const fetchGithubJwks: JwksFetcher = async () => {
  if (jwksCache && Date.now() - jwksCache.at < 60 * 60_000) return jwksCache.keys;
  const res = await fetch(`${OIDC_ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const keys = ((await res.json()) as any).keys as Jwk[];
  jwksCache = { at: Date.now(), keys };
  return keys;
};

const b64json = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

/** Verified claims of a GitHub Actions OIDC token for exactly the ConstructHUB release workflow, or an Error. */
export async function verifyReleaseToken(token: string, opts: { jwks?: JwksFetcher; now?: number } = {}): Promise<Record<string, any>> {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const header = b64json(parts[0]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("unexpected alg/kid");
  const keys = await (opts.jwks ?? fetchGithubJwks)();
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) throw new Error("unknown kid");
  const key = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  const ok = verifySig("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"));
  if (!ok) throw new Error("bad signature");
  const c = b64json(parts[1]);
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (c.iss !== OIDC_ISSUER) throw new Error("wrong issuer");
  if (c.aud !== OIDC_AUDIENCE) throw new Error("wrong audience");
  if (typeof c.exp !== "number" || c.exp < now) throw new Error("expired");
  if (typeof c.nbf === "number" && c.nbf > now + 60) throw new Error("not yet valid");
  if (typeof c.iat !== "number" || c.iat > now + 60 || now - c.iat > 15 * 60) throw new Error("stale token");
  if (c.repository !== ALLOWED_REPO || c.repository_owner !== ALLOWED_REPO.split("/")[0]) throw new Error("wrong repository");
  if (typeof c.job_workflow_ref !== "string" || !c.job_workflow_ref.startsWith(ALLOWED_WORKFLOW)) throw new Error("wrong workflow");
  if (typeof c.ref !== "string" || !ALLOWED_REF.test(c.ref)) throw new Error("wrong ref");
  if (!c.job_workflow_ref.endsWith(`@${c.ref}`)) throw new Error("workflow ref mismatch");
  return c;
}

export function registerCiSigningRoutes(app: Express, opts: { jwks?: JwksFetcher } = {}): void {
  app.get("/api/ci/ios-signing", async (req: Request, res: Response) => {
    res.set({ "Cache-Control": "no-store" });
    const dir = process.env.IOS_SIGNING_DIR;
    const auth = String(req.headers.authorization || "");
    if (!dir || !auth.startsWith("Bearer ")) return res.status(404).json({ message: "Not found" });
    let claims: Record<string, any>;
    try { claims = await verifyReleaseToken(auth.slice(7), { jwks: opts.jwks }); }
    catch (e: any) {
      console.warn(`[ci-signing] refused: ${e?.message ?? e}`);
      return res.status(404).json({ message: "Not found" });
    }
    try {
      const cfg = JSON.parse(readFileSync(join(dir, "asc.json"), "utf8"));
      const p8 = readFileSync(join(dir, `asc-api-${cfg.ascKeyId}.p8`));
      // ConstructHUB's own distribution certificate (.p12 + password) and one App Store profile per app
      // (scripts/asc.ts ensure-signing) — manual signing, so no registered devices are needed.
      const signing = JSON.parse(readFileSync(join(dir, "signing.json"), "utf8"));
      const profiles = Object.fromEntries(Object.entries(signing.profiles as Record<string, { name: string; uuid: string }>).map(([bundle, p]) =>
        [bundle, { name: p.name, uuid: p.uuid, content: readFileSync(join(dir, `${bundle}.mobileprovision`)).toString("base64") }]));
      console.log(`[ci-signing] released to ${claims.job_workflow_ref} run ${claims.run_id ?? "?"} (${claims.actor ?? "?"})`);
      res.json({
        keyId: cfg.ascKeyId, issuerId: cfg.ascIssuerId, teamId: cfg.teamId, p8: p8.toString("base64"),
        p12: readFileSync(join(dir, "dist.p12")).toString("base64"), p12Password: readFileSync(join(dir, "p12-password.txt"), "utf8").trim(),
        profiles,
      });
    } catch (e: any) {
      console.error(`[ci-signing] key unreadable: ${e?.message ?? e}`);
      res.status(500).json({ message: "Signing key unavailable" });
    }
  });
}
