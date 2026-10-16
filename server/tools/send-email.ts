/**
 * The only way a one-off email leaves support@ or social@ (OWNER LAW 2026-10-15). Every message is checked by
 * server/outbound-guard.ts (strict) and refused when it would tell the recipient a bot, a script or an AI is behind
 * us — the Free Law Project email ("signup blocked by the captcha") went out from a hand-written smtplib script.
 * Never send from these mailboxes any other way.
 *
 * On vb11 (server/tools/send-email-cli.ts, built to dist/send-email.cjs):
 *   cd ~/ConstructHUB-live && node --env-file=.env dist/send-email.cjs --from support --to a@x.com \
 *     --subject "…" --body-file /path/body.txt [--cc b@x.com] [--in-reply-to "<id@x>"] [--send]
 * Without --send it only prints the verdict and the message (a dry run).
 *
 * Mailboxes: support → SMTP_EMAIL / SMTP_APP_PASSWORD; social → SOCIAL_SMTP_EMAIL / SOCIAL_SMTP_APP_PASSWORD.
 */
import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";
import { botTellProblem } from "../outbound-guard";
import { signatureHtml, signatureText } from "../email-signature";

export type SendArgs = { from: "support" | "social"; to: string; cc: string | null; subject: string; body: string; inReplyTo: string | null; send: boolean };

export function parseArgs(argv: string[], readFile: (p: string) => string = (p) => readFileSync(p, "utf8")): SendArgs {
  const get = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : null; };
  const from = get("from");
  if (from !== "support" && from !== "social") throw new Error('--from must be "support" or "social"');
  const to = get("to"), subject = get("subject"), bodyFile = get("body-file"), body = get("body");
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error("--to needs one email address");
  if (!subject) throw new Error("--subject is required");
  const text = bodyFile ? readFile(bodyFile) : body;
  if (!text?.trim()) throw new Error("--body-file (or --body) is required");
  return { from, to, cc: get("cc"), subject, body: text.trim(), inReplyTo: get("in-reply-to"), send: argv.includes("--send") };
}

export function mailbox(from: SendArgs["from"], env: NodeJS.ProcessEnv = process.env): { user: string; pass: string } {
  const user = (from === "support" ? env.SMTP_EMAIL : env.SOCIAL_SMTP_EMAIL)?.trim() ?? "";
  const pass = (from === "support" ? env.SMTP_APP_PASSWORD : env.SOCIAL_SMTP_APP_PASSWORD)?.trim() ?? "";
  if (!user || !pass) throw new Error(`${from}@ is not configured here (${from === "support" ? "SMTP_EMAIL / SMTP_APP_PASSWORD" : "SOCIAL_SMTP_EMAIL / SOCIAL_SMTP_APP_PASSWORD"})`);
  return { user, pass };
}

export async function run(argv: string[], deps = { log: console.log, transport: (u: string, p: string) => nodemailer.createTransport({ service: "gmail", auth: { user: u, pass: p } }) }): Promise<number> {
  const a = parseArgs(argv);
  const problem = botTellProblem(`${a.subject}\n${a.body}`);
  if (problem) {
    deps.log(`REFUSED: ${problem}. OWNER LAW 2026-10-15: never reveal a bot, a script or an AI to an outsider. Reword it; never report a CAPTCHA or blocked sign-up to the company — tell the owner instead.`);
    return 2;
  }
  const box = mailbox(a.from);
  deps.log(`From: ${box.user}\nTo: ${a.to}${a.cc ? `\nCc: ${a.cc}` : ""}\nSubject: ${a.subject}\n\n${a.body}\n\n(guard: clean)`);
  if (!a.send) { deps.log("Dry run: add --send to send it."); return 0; }
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const info = await deps.transport(box.user, box.pass).sendMail({
    from: `"Construct HUB" <${box.user}>`, to: a.to, ...(a.cc ? { cc: a.cc } : {}), subject: a.subject,
    text: `${a.body}\n\n${signatureText({ email: box.user })}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;">${esc(a.body).replace(/\n/g, "<br>")}${signatureHtml({ email: box.user })}</div>`,
    ...(a.inReplyTo ? { inReplyTo: a.inReplyTo, references: a.inReplyTo } : {}),
  });
  deps.log(`Sent: ${info.messageId}`);
  return 0;
}
