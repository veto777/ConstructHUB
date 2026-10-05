// Isolated HTTP harness: real sessions/routes/database, fake Google transport only.
// Never imported by the application; no external provider calls or background jobs.
import express from "express";
import passport from "passport";
import { setupAuth } from "../auth";
import { pool } from "../db";
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
await setupAuth(app);
const strategy = (passport as any)._strategy("google");
strategy._oauth2.getOAuthAccessToken = (code: string, _params: unknown, done: Function) => done(null, code, "", {});
strategy.userProfile = async (token: string, done: Function) => {
  const { rows: [u] } = await pool.query("SELECT google_id,email FROM users WHERE google_id=$1", [token]);
  if (!u) return done(new Error("Unknown fixture"));
  done(null, { id: u.google_id, emails: [{ value: u.email }], displayName: "App test" });
};
if (process.env.APP_TEST_CONNECTIONS === "true") {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(String(init?.body));
      if (params.get("code") === "provider-failure") return Response.json({error:"invalid_grant"}, {status:400});
      return Response.json({ access_token:"fixture-access", refresh_token:"fixture-refresh", expires_in:3600,
        scope:"https://www.googleapis.com/auth/business.manage https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/webmasters https://www.googleapis.com/auth/gmail.readonly" });
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") return Response.json({sub:"fixture-subject",email:"fixture@example.invalid",email_verified:true});
    if (url.startsWith("https://googleads.googleapis.com/")) return Response.json({resourceNames:[],results:[]});
    throw Error("Unexpected external request in app fixture");
  };
  const auth = (req: any, res: any) => { if (req.user) return req.user; res.status(401).json({message:"Not authenticated"}); };
  const { registerGbpRoutes } = await import("../gbp/routes");
  const { registerAdsRoutes } = await import("../ads/routes");
  const { registerGscRoutes } = await import("../gsc/routes");
  const { registerGmailOAuth } = await import("../mail-alerts/gmail");
  const { registerLsaRoutes } = await import("../lsa/routes");
  const { registerCrmCalendarRoutes } = await import("../crm/calendar");
  registerGbpRoutes(app, auth, { http:fetch, afterConnect: async () => {} });
  registerAdsRoutes(app, auth, {http:fetch});
  registerGscRoutes(app, auth, fetch);
  registerGmailOAuth(app, auth, fetch);
  registerLsaRoutes(app, auth);
  registerCrmCalendarRoutes(app, auth);
}
const server = app.listen(0, "127.0.0.1", () => {
  const addr = server.address() as import("net").AddressInfo;
  process.send?.({ port: addr.port });
});
process.on("SIGTERM", () => server.close(() => void pool.end().then(() => process.exit(0))));
