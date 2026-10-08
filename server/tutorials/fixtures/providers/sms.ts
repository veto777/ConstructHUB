/**
 * TEXT MESSAGING — tutorial fixture. Recording slots only (../gate.ts).
 *
 * Seam: the platform sender (the four SIGNALWIRE_* values) and the carrier `fetch` inside
 * signalwireSend() in server/crm/sms.ts. In a slot the platform sender is a stand-in and the
 * carrier call is answered here: the text is appended to the slot's own SMS outbox file (the same
 * dev sink the log provider writes) and gets a message id back — so plan checks, opt-outs, the
 * monthly allowance, the "also text it" switch and the thread note all run as in production.
 * No text leaves the machine. Numbers are fictional (555-01xx).
 *
 * The demo company's OWN number (what lets it text clients) is seeded as org settings by
 * scripts/tutorials/seed-fixtures.ts: mode "dedicated", from +1 941 555 0100.
 */
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { defineProviderFixture, requireTutorialFixtures } from "../registry";

export type SmsFixture = {
  /** The platform's shared sender (contractor-facing alerts). */
  platform: { space: string; project: string; token: string; from: string };
  fetch: typeof fetch;
};

export const FIXTURE_SMS_PLATFORM_NUMBER = "+18135550199";
export const FIXTURE_SMS_COMPANY_NUMBER = "+19415550100";
const outbox = () => process.env.SMS_OUTBOX_PATH ?? path.join(process.cwd(), "tmp", "sms-outbox.jsonl");

const carrierFetch: typeof fetch = async (input, init = {}) => {
  requireTutorialFixtures("the texting stand-in");
  const url = new URL(String(input));
  if (!/\/Messages\.json$/.test(url.pathname)) return Response.json({ message: "not implemented by the texting stand-in" }, { status: 400 });
  const f = new URLSearchParams(String(init.body || ""));
  const sid = `SMtutfx${randomBytes(12).toString("hex")}`;
  const entry = { at: new Date().toISOString(), provider: "tutorial-fixture", sid, from: f.get("From"), to: f.get("To"), body: f.get("Body") };
  try { fs.mkdirSync(path.dirname(outbox()), { recursive: true }); fs.appendFileSync(outbox(), JSON.stringify(entry) + "\n"); } catch { /* the sink is a convenience */ }
  return Response.json({ sid, status: "queued", from: entry.from, to: entry.to }, { status: 201 });
};

export const smsFixture = defineProviderFixture<SmsFixture>({
  id: "sms",
  simulates: "A texting carrier: a platform sender plus the demo company's own number, sends that land in the slot's SMS outbox file, and inbound texts (STOP, START, HELP, a reply) posted to the real carrier webhook.",
  seam: "server/crm/sms.ts — smsMissingEnv(), platformSender() and the fetch in signalwireSend()",
  adapter: () => ({
    platform: { space: "sms.tutfx.example.com", project: "tutfx-project", token: `tutfx-${randomBytes(12).toString("hex")}`, from: FIXTURE_SMS_PLATFORM_NUMBER },
    fetch: carrierFetch,
  }),
  actions: {
    /**
     * A text arrives from a phone: posted to the product's real carrier webhook, form-encoded as a
     * carrier sends it. { from: "+19415550134", body: "STOP", to? }
     * (The product acts on STOP / START / HELP and Call Assistant confirmations; it does not thread
     * a client's free-text reply — so a video must not claim it does.)
     */
    inbound: async (input) => {
      const from = String(input.from || ""), body = String(input.body || "");
      if (!/^\+1\d{3}55501\d\d$/.test(from)) throw new Error("`from` must be a fictional +1XXX55501XX number");
      const r = await fetch(`http://127.0.0.1:${process.env.PORT}/api/crm/sms/inbound`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: from, To: String(input.to || FIXTURE_SMS_COMPANY_NUMBER), Body: body }).toString(),
      });
      return { status: r.status, reply: (await r.text()).replace(/<[^>]+>/g, "").trim() };
    },
    /** The last text the slot "sent" (to show a script what went out). */
    last: async () => {
      try { const lines = fs.readFileSync(outbox(), "utf8").trim().split("\n"); return { last: JSON.parse(lines[lines.length - 1]) }; } catch { return { last: null }; }
    },
  },
});
