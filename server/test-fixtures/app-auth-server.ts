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
const server = app.listen(0, "127.0.0.1", () => {
  const addr = server.address() as import("net").AddressInfo;
  process.send?.({ port: addr.port });
});
process.on("SIGTERM", () => server.close(() => void pool.end().then(() => process.exit(0))));
