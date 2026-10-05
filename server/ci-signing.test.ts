/** The iPhone build's signing-key handoff (server/ci-signing.ts): only ConstructHUB's own release workflow gets it. */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createSign } from "crypto";
import { verifyReleaseToken, OIDC_ISSUER, OIDC_AUDIENCE } from "./ci-signing";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as any), kid: "k1", kty: "RSA" };
const jwks = async () => [jwk];
const NOW = 1_800_000_000_000;
const now = Math.floor(NOW / 1000);
const good = {
  iss: OIDC_ISSUER, aud: OIDC_AUDIENCE, iat: now - 30, nbf: now - 30, exp: now + 300,
  repository: "veto777/ConstructHUB", repository_owner: "veto777", ref: "refs/heads/main",
  job_workflow_ref: "veto777/ConstructHUB/.github/workflows/ios-release.yml@refs/heads/main", run_id: "1", actor: "veto777",
};
function sign(claims: Record<string, unknown>, key = privateKey, header: Record<string, unknown> = { alg: "RS256", kid: "k1", typ: "JWT" }) {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${b(header)}.${b(claims)}`;
  return `${data}.${createSign("RSA-SHA256").update(data).sign(key).toString("base64url")}`;
}
const check = (t: string) => verifyReleaseToken(t, { jwks, now: NOW });

describe("signing key handoff: only veto777/ConstructHUB's ios-release workflow on main or an ios-v* tag", () => {
  it("accepts exactly that workflow (main, and a release tag)", async () => {
    await expect(check(sign(good))).resolves.toMatchObject({ repository: "veto777/ConstructHUB" });
    await expect(check(sign({ ...good, ref: "refs/tags/ios-v1.0.0", job_workflow_ref: "veto777/ConstructHUB/.github/workflows/ios-release.yml@refs/tags/ios-v1.0.0" }))).resolves.toBeTruthy();
  });
  it("refuses everything else", async () => {
    const bad: [string, Record<string, unknown>][] = [
      ["another repo", { repository: "veto777/Remindr", repository_owner: "veto777" }],
      ["a fork owner", { repository: "attacker/ConstructHUB", repository_owner: "attacker" }],
      ["another workflow", { job_workflow_ref: "veto777/ConstructHUB/.github/workflows/other.yml@refs/heads/main" }],
      ["a feature branch", { ref: "refs/heads/feature", job_workflow_ref: "veto777/ConstructHUB/.github/workflows/ios-release.yml@refs/heads/feature" }],
      ["a pull request ref", { ref: "refs/pull/1/merge", job_workflow_ref: "veto777/ConstructHUB/.github/workflows/ios-release.yml@refs/pull/1/merge" }],
      ["wrong audience", { aud: "sts.amazonaws.com" }],
      ["wrong issuer", { iss: "https://evil.example" }],
      ["expired", { exp: now - 1 }],
      ["stale", { iat: now - 3600 }],
      ["workflow ref ≠ ref", { job_workflow_ref: "veto777/ConstructHUB/.github/workflows/ios-release.yml@refs/heads/other" }],
    ];
    for (const [why, patch] of bad) await expect(check(sign({ ...good, ...patch })), why).rejects.toThrow();
    await expect(check(sign(good, other.privateKey)), "signed by someone else").rejects.toThrow(/signature/);
    await expect(check(sign(good, privateKey, { alg: "none", kid: "k1" })), "alg none").rejects.toThrow();
    await expect(check(sign(good, privateKey, { alg: "RS256", kid: "nope" })), "unknown kid").rejects.toThrow();
    await expect(check("not.a.jwt"), "garbage").rejects.toThrow();
  });
});
