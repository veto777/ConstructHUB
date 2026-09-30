import { randomBytes, createHash } from "node:crypto";
import { pool } from "../db";
import { encryptToken, decryptToken } from "../gbp/token-crypto";
import { notifyUser, logActivity } from "../account-events";
import { parseMail, classifyMail, type Mail } from "./classify";
import { getEntitlements } from "../entitlements";
import { MODULE_NAMES, PLANS, planForModule } from "@shared/plans";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function forwardingAddress(userId: number) {
  const domain = process.env.INBOUND_MAIL_DOMAIN;
  if (!domain || !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i.test(domain)) return null;
  const token = randomBytes(24).toString("hex");
  await pool.query(
    "INSERT INTO mail_alert_addresses(user_id,token_hash,token_cipher) VALUES($1,$2,$3) ON CONFLICT(user_id) DO NOTHING",
    [userId, hash(token), encryptToken(token)],
  );
  const {
    rows: [r],
  } = await pool.query(
    "SELECT token_cipher FROM mail_alert_addresses WHERE user_id=$1",
    [userId],
  );
  return `alerts+${decryptToken(r.token_cipher)}@${domain.toLowerCase()}`;
}
export async function purgeExpiredMail() {
  await pool.query("DELETE FROM mail_alert_messages WHERE expires_at<=now()");
}
/** How long a stored alert is kept (expires_at), whether or not the plan shows it yet. */
export const MAIL_RETENTION_DAYS = 30;
const mailPlan = PLANS[planForModule("domainsMailAlerts")].name;
/** Notification text for an alert kept while the owner's plan doesn't include the module. */
export const HELD_ALERT_NOTE = `It is kept for ${MAIL_RETENTION_DAYS} days and shows in Mail alerts once your plan includes ${MODULE_NAMES.domainsMailAlerts} (the ${mailPlan} plan).`;
/**
 * Store a recognised provider alert. `entitled: false` (the owner's plan lacks
 * the module) still stores it for the same 30 days; only the notification
 * wording changes, since the message can't be opened until the plan includes it.
 */
export async function storeMatched(
  userId: number,
  mail: Mail,
  source: "forwarding" | "gmail",
  receivedAt = new Date(),
  opts: { entitled?: boolean } = {},
) {
  const entitled = opts.entitled ?? true;
  const c = classifyMail(mail);
  if (!c || receivedAt.getTime() < Date.now() - MAIL_RETENTION_DAYS * 86400000) return false;
  const text = `${mail.subject}\n${mail.text}`.toLowerCase();
  // Extract candidate hostnames once, then use indexed equality; don't load an agency's whole inventory.
  const domains = [
    ...new Set(
      text.match(/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}/g) || [],
    ),
  ].slice(0, 500);
  const { rows: matches } = await pool.query(
    "SELECT id,location_id FROM managed_domains WHERE user_id=$1 AND domain=ANY($2::text[]) LIMIT 2",
    [userId, domains],
  );
  let domainId = matches.length === 1 ? matches[0].id : null,
    locationId = matches.length === 1 ? matches[0].location_id : null;
  if (!locationId && matches.length === 0) {
    const { rows } = await pool.query(
      "SELECT id FROM business_locations WHERE user_id=$1 AND length(business_name)>=4 AND position(lower(business_name) in $2)>0 LIMIT 2",
      [userId, text],
    );
    if (rows.length === 1) locationId = rows[0].id;
  }
  const dedupe = hash(
    `${source}:${mail.messageId || `${c.sender}:${mail.subject}:${mail.text}`}`,
  );
  const {
    rows: [row],
  } = await pool.query(
    `INSERT INTO mail_alert_messages(user_id,dedupe,source,category,severity,sender,subject,body,confirmation_code,confirmation_link,domain_id,location_id,received_at,expires_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13::timestamptz+make_interval(days=>${MAIL_RETENTION_DAYS})) ON CONFLICT(user_id,dedupe) DO NOTHING RETURNING id`,
    [
      userId,
      dedupe,
      source,
      c.category,
      c.severity,
      c.sender,
      mail.subject.slice(0, 1000),
      mail.text.slice(0, 16000),
      c.code,
      c.link,
      domainId,
      locationId,
      receivedAt,
    ],
  );
  if (row) {
    await logActivity(null, userId, "mail.alert", {
      messageId: row.id,
      category: c.category,
      domainId,
      locationId,
      severity: c.severity,
      ...(entitled ? {} : { heldForPlan: true }),
    });
    await notifyUser(
      userId,
      c.severity === "critical" ? "mail.security" : "mail.alert",
      {
        title:
          c.severity === "critical"
            ? "Critical provider email alert"
            : "Provider email alert received",
        body: entitled
          ? `${c.category} alert. Review the message in ConstructHUB.`
          : `${c.category} alert. ${HELD_ALERT_NOTE}`,
        link: "/mail-alerts",
        severity: c.severity,
      },
    );
  }
  return true;
}
export async function ingest(raw: unknown, envelopeTo?: string) {
  const mail = await parseMail(raw);
  if (envelopeTo) mail.to = envelopeTo;
  const domain = process.env.INBOUND_MAIL_DOMAIN?.toLowerCase();
  if (!domain) return;
  const recipients =
    mail.to.toLowerCase().match(/[a-z0-9+._-]+@[a-z0-9.-]+/g) || [];
  const tokens = recipients
    .map((s) => s.match(/^alerts\+([a-f0-9]{48})@(.+)$/))
    .filter((m) => m && m[2] === domain)
    .map((m) => hash(m![1]));
  if (!tokens.length) return;
  const { rows } = await pool.query(
    "SELECT user_id FROM mail_alert_addresses WHERE token_hash=ANY($1::text[]) LIMIT 10",
    [tokens],
  );
  // Forwarded alerts are never dropped. An owner whose plan doesn't include the
  // module has them kept for the usual 30 days and shown once the plan does
  // (the list lives behind the plan gate); they are told one arrived.
  for (const row of rows)
    await storeMatched(row.user_id, mail, "forwarding", new Date(), {
      entitled: (await getEntitlements(row.user_id)).modules.domainsMailAlerts,
    });
}
