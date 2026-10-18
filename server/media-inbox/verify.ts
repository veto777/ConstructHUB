/**
 * Does this mailbox exist? Asked of the recipient's own mail server before a cold email goes out (2026-10-17: 20 of 463
 * first-contact emails bounced, ~4%, e.g. "550 5.1.1 User Unknown" from applicationsprogramming@azfamily.com; Gmail
 * flags senders past ~2%). The SMTP conversation stops after RCPT TO: nothing is ever sent.
 *   "no"      the server refused the recipient itself (550/551/553, or 5.1.x) — skip the address;
 *   "ok"      the server accepted it (a catch-all domain accepts everything, so this is a "maybe");
 *   "unknown" no answer, a temporary error, or a refusal aimed at us (blocklist, policy) — send as before.
 * vb11 sits on a home connection that Spamhaus lists (PBL), so Microsoft 365 and other filtered hosts won't answer it.
 * MAIL_CHECK_SSH names an ssh host (vb11: `vb7mirror`, ConstructHUB's fallback box on a clean address) to ask through
 * instead (`ssh -W`, one shared connection); unset, the check connects directly.
 */
import net from "node:net";
import { spawn } from "node:child_process";
import { Duplex } from "node:stream";
import { promises as dns } from "node:dns";

export type MailboxCheck = { verdict: "ok" | "no" | "unknown"; reply: string };
type Reply = { stage: string; code: number; text: string };

const STAGES = ["banner", "ehlo", "mail", "rcpt"] as const;
// A refusal about us (our IP, a blocklist, policy), not about the recipient.
const ABOUT_US = /block|spamhaus|barracuda|black ?list|listed|reputation|policy|rbl|dnsbl|spf|dmarc|client host|your ip|\bip\b|rate|too many|try again/i;

/** A connection to host:25, directly or through MAIL_CHECK_SSH. */
function openSmtp(host: string): Duplex {
  const via = process.env.MAIL_CHECK_SSH?.trim();
  if (!via) return net.connect({ host, port: 25 });
  const ssh = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ControlMaster=auto",
    "-o", "ControlPath=/tmp/mailcheck-%r@%h:%p", "-o", "ControlPersist=10m", "-W", `${host}:25`, via], { stdio: ["pipe", "pipe", "ignore"] });
  const d = Duplex.from({ readable: ssh.stdout, writable: ssh.stdin });
  ssh.on("error", (e) => d.destroy(e));
  ssh.on("exit", () => d.destroy());
  d.on("close", () => ssh.kill());
  return d;
}

function rcptReply(host: string, rcpt: string, from: string, helo: string, timeoutMs: number): Promise<Reply> {
  return new Promise((resolve) => {
    const sock = openSmtp(host);
    let buf = "", stage: (typeof STAGES)[number] = "banner", done = false;
    const commands: Record<string, string> = { ehlo: `EHLO ${helo}`, mail: `MAIL FROM:<${from}>`, rcpt: `RCPT TO:<${rcpt}>` };
    const finish = (r: Reply) => {
      if (done) return;
      done = true;
      try { sock.end("QUIT\r\n"); } catch { /* closing anyway */ }
      sock.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ stage, code: 0, text: "timeout" }), timeoutMs);
    sock.on("close", () => clearTimeout(timer));
    sock.on("error", (e) => finish({ stage, code: 0, text: e.message }));
    sock.on("close", () => finish({ stage, code: 0, text: "connection closed" }));
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const m = /^(\d{3})([ -])(.*)$/.exec(line);
        if (!m || m[2] === "-") continue; // continuation of a multi-line reply
        const code = Number(m[1]);
        if (stage === "rcpt" || code >= 400) return finish({ stage, code, text: m[3].trim() });
        stage = STAGES[STAGES.indexOf(stage) + 1];
        sock.write(`${commands[stage]}\r\n`);
      }
    });
  });
}

/** What a server's answer says about the mailbox (exported for tests). */
export function classify(r: Reply): MailboxCheck["verdict"] {
  if (r.stage !== "rcpt" || r.code === 0) return "unknown";
  if (r.code === 250 || r.code === 251) return "ok";
  if (r.code < 500 || ABOUT_US.test(r.text)) return "unknown";
  if ([550, 551, 553].includes(r.code) || /\b5\.1\.\d+\b/.test(r.text)) return "no";
  return "unknown";
}

export const verifyDeps = { rcptReply, resolveMx: (d: string) => dns.resolveMx(d) };

export async function checkMailbox(email: string, from: string, timeoutMs = 10_000): Promise<MailboxCheck> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return { verdict: "no", reply: "not an email address" };
  let hosts: string[];
  try {
    hosts = (await verifyDeps.resolveMx(domain)).filter((r) => r.exchange && r.exchange !== ".").sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
  } catch {
    return { verdict: "unknown", reply: "no MX lookup" };
  }
  let last = "no mail server";
  // Two hosts at most: a timeout on the first (some filters stall unknown senders) gets one more try.
  for (const host of hosts.slice(0, 2)) {
    const r = await verifyDeps.rcptReply(host, email, from, from.split("@")[1] || "localhost", timeoutMs);
    last = r.code ? `${r.code} ${r.text}` : r.text;
    if (r.code !== 0) return { verdict: classify(r), reply: last.slice(0, 200) };
  }
  return { verdict: "unknown", reply: last.slice(0, 200) };
}
