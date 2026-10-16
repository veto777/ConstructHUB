import { describe, expect, it } from "vitest";
import { botTellProblem, assertNoBotTell, BotTellError } from "./outbound-guard";
import { parseArgs, run } from "./tools/send-email";
import { composePitch } from "./backlinks/outreach";

describe("outbound guard — OWNER LAW 2026-10-15: nothing to an outsider gives a bot away", () => {
  it.each([
    "CourtListener API account: signup blocked by the captcha",
    "the signup page's verification puzzle wouldn't complete for us",
    "Our crawler respects robots.txt.",
    "We hit your rate limit.",
    "Yes. ConstructHUB uses an AI assistant for parts of our operations, and an AI assistant wrote that email.",
    "As an AI, I can't decide that.",
  ])("hard and strict both refuse %j", (t) => {
    expect(botTellProblem(t, "hard")).not.toBeNull();
    expect(botTellProblem(t, "strict")).not.toBeNull();
  });
  it.each([
    "We're building an automated system for this.",
    "Is there a programmatic way to submit?",
    "We use ChatGPT for drafts.",
  ])("strict refuses %j, hard lets the customer's own news say it", (t) => {
    expect(botTellProblem(t, "strict")).not.toBeNull();
    expect(botTellProblem(t, "hard")).toBeNull();
  });
  it("Claude's Roofing is a business name only under the hard check", () => expect(botTellProblem("Claude's Roofing opens a second location", "hard")).toBeNull());
  it("plain outreach passes", () => expect(botTellProblem("Could you tell us how to submit a release, what it costs and whether it links to the company's site?")).toBeNull());
  it("assertNoBotTell throws a BotTellError naming the recipient", () =>
    expect(() => assertNoBotTell({ to: "info@free.law", subject: "signup blocked by the captcha", body: "hi" })).toThrow(BotTellError));
});

describe("send-email (the only one-off sender for support@ and social@)", () => {
  const base = ["--from", "support", "--to", "x@example.com", "--subject", "Hello"];
  it("parses a body file", () => expect(parseArgs([...base, "--body-file", "b.txt"], () => "Hi there\n").body).toBe("Hi there"));
  it("refuses a bot tell and never builds a transport", async () => {
    const logs: string[] = [];
    let made = false;
    const code = await run([...base, "--body", "Our signup was blocked by the captcha.", "--send"], { log: (l) => logs.push(l), transport: () => { made = true; return {} as any; } });
    expect(code).toBe(2);
    expect(made).toBe(false);
    expect(logs.join("\n")).toMatch(/^REFUSED/);
  });
  it("a dry run sends nothing", async () => {
    const prev = { e: process.env.SMTP_EMAIL, p: process.env.SMTP_APP_PASSWORD };
    process.env.SMTP_EMAIL = "support@constructhub.us"; process.env.SMTP_APP_PASSWORD = "x";
    let made = false;
    const code = await run([...base, "--body", "Could you send your pricing?"], { log: () => undefined, transport: () => { made = true; return {} as any; } });
    process.env.SMTP_EMAIL = prev.e; process.env.SMTP_APP_PASSWORD = prev.p;
    expect(code).toBe(0);
    expect(made).toBe(false);
  });
  it("social@ needs its own app password", () => expect(() => parseArgs(["--from", "media", "--to", "a@b.co", "--subject", "s", "--body", "b"])).toThrow());
});

describe("backlink outreach templates pass the strict check", () => {
  it.each(["resource_page", "editorial", "press_release", "directory", "other"])("%s", (kind) => {
    const t = composePitch(kind as any, "acme.example", null, "Leah Peterson");
    expect(botTellProblem(`${t.subject}\n${t.body}`)).toBeNull();
  });
});
