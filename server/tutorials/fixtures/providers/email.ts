/**
 * EMAIL — tutorial fixture. Recording slots only (../gate.ts).
 *
 * Email in a slot is already a dev sink (EMAIL_FORCE_SINK=1 → tmp/email-outbox.jsonl; nothing is
 * sent). Seam: `sinkToOutbox()` in server/email.ts hands each sunk message to `captured()` here,
 * which keeps the last few IN MEMORY so the recorder can do what the recipient would do:
 *
 *   email.link    the link in the newest email to an address — the client's sign-in link, the
 *                 "View estimate" button, an invoice, a change order, a team invitation, a photo
 *                 gallery. The recorder opens it in the homeowner's (or the invitee's) session.
 *                 Local-only, never logged: fixture routes sit outside /api, which is all the
 *                 request log prints.
 *   email.opened  marks a sent estimate or invoice as opened by the client at a believable time
 *                 in the past, writing exactly what the public page's own open tracking writes.
 *   email.count   how many emails an address has received (to wait for a send).
 */
import { defineProviderFixture, requireTutorialFixtures } from "../registry";
import { FIXTURE_MARK } from "../gate";

export type EmailFixture = { captured: (mail: { to?: unknown; subject?: unknown; html?: unknown; text?: unknown }) => void };

type Kept = { at: number; to: string[]; subject: string; links: string[] };
const kept: Kept[] = [];
const KEEP = 60;

function captured(mail: { to?: unknown; subject?: unknown; html?: unknown; text?: unknown }) {
  const to = [mail.to].flat().filter(Boolean).map((t) => String(t).toLowerCase());
  const body = `${typeof mail.html === "string" ? mail.html : ""}\n${typeof mail.text === "string" ? mail.text : ""}`;
  const links = [...new Set([...body.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0].replace(/&amp;/g, "&")))];
  kept.push({ at: Date.now(), to, subject: String(mail.subject ?? ""), links });
  if (kept.length > KEEP) kept.splice(0, kept.length - KEEP);
}
const forAddress = (to: string) => kept.filter((k) => k.to.some((t) => t.includes(to.toLowerCase())));

/** A documentation-range address (RFC 5737): the "client's" IP on fixture open events. */
const CLIENT_IP = "203.0.113.24";
const CLIENT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export const emailFixture = defineProviderFixture<EmailFixture>({
  id: "email",
  simulates: "The recipient's inbox: the links in the emails the slot sank (sign-in link, document links, invitations), and a client opening a sent estimate or invoice at a believable earlier time.",
  seam: "server/email.ts — sinkToOutbox() (the existing dev sink) calls captured()",
  adapter: () => ({ captured }),
  actions: {
    /** { to, match?, subject? } → { url, path }. `match` is a substring of the link; the newest email wins. */
    link: async (input) => {
      requireTutorialFixtures("reading an emailed link");
      const to = String(input.to || "");
      if (!to.endsWith("example.com")) throw new Error("`to` must be an example.com address");
      const mails = forAddress(to).filter((k) => !input.subject || k.subject.toLowerCase().includes(String(input.subject).toLowerCase())).reverse();
      for (const mail of mails) {
        const url = mail.links.find((l) => (input.match ? l.includes(String(input.match)) : !/\.(png|jpe?g|gif|svg|webp)(\?|$)/i.test(l)));
        if (url) { const u = new URL(url); return { url, path: `${u.pathname}${u.search}`, subject: mail.subject }; }
      }
      throw new Error(`no email to ${to} with ${input.match ? `a link containing "${input.match}"` : "a link"} has been sent in this slot`);
    },
    count: async (input) => ({ count: forAddress(String(input.to || "")).length }),
    /**
     * { estimate?: "E-2000", invoice?: "INV-1999", minutesAgo?: 90, visits?: 1, seconds?: 150 }
     * The same rows the public page writes on a real open (server/crm/portal.ts), dated in the past.
     */
    opened: async (input, { orgId }) => {
      requireTutorialFixtures("marking a document opened");
      const { pool } = await import("../../../db");
      const minutes = Math.max(1, Math.min(60 * 24 * 60, Number(input.minutesAgo) || 90));
      const visits = Math.max(1, Math.min(6, Math.round(Number(input.visits) || 1)));
      const seconds = Math.max(10, Math.min(3600, Math.round(Number(input.seconds) || 150)));
      if (input.estimate) {
        const { rows: [est] } = await pool.query(`select id, sent_at, first_viewed_at from crm_estimates where org_id = $1 and number = $2`, [orgId, String(input.estimate)]);
        if (!est) throw new Error(`no estimate ${input.estimate}`);
        if (!est.sent_at) throw new Error(`${input.estimate} has not been sent — an unsent estimate cannot have been opened`);
        await pool.query(
          `update crm_estimates set first_viewed_at = coalesce(first_viewed_at, now() - make_interval(mins => $2)), last_viewed_at = now() - make_interval(mins => $3),
             view_count = coalesce(view_count, 0) + $4, status = case when status = 'sent' then 'viewed' else status end where id = $1`,
          [est.id, minutes, Math.max(1, Math.round(minutes / visits)), visits]);
        for (let i = 0; i < visits; i++) {
          const ago = Math.max(1, Math.round(minutes - (i * minutes) / visits));
          await pool.query(`insert into crm_estimate_events (org_id, estimate_id, type, actor, ip, user_agent, meta, created_at) values ($1,$2,'viewed','client',$3,$4,$5::jsonb, now() - make_interval(mins => $6))`,
            [orgId, est.id, CLIENT_IP, CLIENT_UA, JSON.stringify({ firstView: i === 0 && !est.first_viewed_at, fixture: FIXTURE_MARK.id }), ago]);
          await pool.query(`insert into crm_engagement_sessions (id, org_id, doc_type, doc_id, started_at, last_ping_at, duration_secs, ip, user_agent, created_at)
                             values ($1,$2,'estimate',$3, now() - make_interval(mins => $4), now() - make_interval(mins => $4) + make_interval(secs => $5), $5, $6, $7, now() - make_interval(mins => $4))`,
            [`${FIXTURE_MARK.id}visit-${est.id}-${Date.now()}-${i}`, orgId, est.id, ago, Math.round(seconds / visits), CLIENT_IP, CLIENT_UA]);
        }
        return { estimate: input.estimate, visits };
      }
      if (input.invoice) {
        const { rows: [inv] } = await pool.query(`select id, sent_at from crm_invoices where org_id = $1 and number = $2`, [orgId, String(input.invoice)]);
        if (!inv) throw new Error(`no invoice ${input.invoice}`);
        if (!inv.sent_at) throw new Error(`${input.invoice} has not been sent`);
        await pool.query(`update crm_invoices set first_viewed_at = coalesce(first_viewed_at, now() - make_interval(mins => $2)), view_count = coalesce(view_count, 0) + $3 where id = $1`, [inv.id, minutes, visits]);
        return { invoice: input.invoice, visits };
      }
      throw new Error("pass `estimate` or `invoice` (its number)");
    },
  },
});
