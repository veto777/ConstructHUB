/**
 * Submit both iPhone apps for App Review through the App Store Connect API.
 *   npx tsx scripts/asc-submit.ts            try once: submit every app Apple accepts; print what blocks the others
 *   npx tsx scripts/asc-submit.ts --watch    keep trying every 2 minutes (up to 6 h) until both are submitted
 * Each app goes in on its own as soon as Apple accepts it (e.g. the moment its App Privacy answers are published).
 * Status changes after that reach the admins' bell + phone via server/ops/app-review-watch.ts.
 */
import { asc } from "./asc";

const APPS = [{ id: "6819417454", name: "ConstructHUB: Contractor Tools" }, { id: "6819417824", name: "ConstructHUB CRM" }];
const done = new Set<string>();

async function trySubmit(app: { id: string; name: string }): Promise<string> {
  const [version] = (await asc("GET", `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=1`)).data;
  if (version.attributes.appStoreState !== "PREPARE_FOR_SUBMISSION") return `already ${version.attributes.appStoreState}`;
  const open = (await asc("GET", `/v1/reviewSubmissions?filter[app]=${app.id}&filter[state]=READY_FOR_REVIEW&limit=1`)).data[0];
  const sub = open ?? (await asc("POST", "/v1/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform: "IOS" },
    relationships: { app: { data: { type: "apps", id: app.id } } } } })).data;
  const items = (await asc("GET", `/v1/reviewSubmissions/${sub.id}/items`)).data;
  if (!items.length) {
    try {
      await asc("POST", "/v1/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: {
        reviewSubmission: { data: { type: "reviewSubmissions", id: sub.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } } });
    } catch (e: any) {
      const why = (e.json?.errors ?? []).flatMap((x: any) => Object.values(x.meta?.associatedErrors ?? {}).flat().map((a: any) => a.detail) .concat(x.meta?.associatedErrors ? [] : [x.detail]));
      return `not yet: ${why.join("; ") || e.message}`;
    }
  }
  await asc("PATCH", `/v1/reviewSubmissions/${sub.id}`, { data: { type: "reviewSubmissions", id: sub.id, attributes: { submitted: true } } });
  return "SUBMITTED for review";
}

async function round(): Promise<boolean> {
  for (const app of APPS) {
    if (done.has(app.id)) continue;
    try {
      const r = await trySubmit(app);
      console.log(`${new Date().toISOString()} ${app.name}: ${r}`);
      if (r.startsWith("SUBMITTED") || r.startsWith("already")) done.add(app.id);
    } catch (e: any) { console.log(`${new Date().toISOString()} ${app.name}: error ${e.message}`); }
  }
  return done.size === APPS.length;
}

async function main() {
  if (!process.argv.includes("--watch")) { await round(); return; }
  for (let i = 0; i < 180; i++) {
    if (await round()) { console.log("both apps submitted"); return; }
    await new Promise((r) => setTimeout(r, 120_000));
  }
  console.log("stopped watching after 6 h");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
