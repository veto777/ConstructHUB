import { describe, expect, it } from "vitest";
import { companyDomain, firstNameOf, holdingReply, machineReason, replyProblem, replySubject } from "./guard";
import { parseDecision } from "./ai";
import { stripQuoted, composeMail } from "./mailbox";

const person = { fromEmail: "jane@directoryco.com", subject: "Re: Listings partnership" };

describe("machineReason — machine senders are logged, never answered", () => {
  it("lets a person through", () => expect(machineReason(person)).toBeNull());
  it.each([
    [{ fromEmail: "no-reply@accounts.google.com", subject: "Security alert" }],
    [{ fromEmail: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)" }],
    [{ fromEmail: "support@constructhub.us", subject: "hi" }],
    [{ ...person, autoSubmitted: "auto-replied" }],
    [{ ...person, subject: "Out of Office: back Monday" }],
    [{ ...person, precedence: "bulk" }],
    [{ ...person, listUnsubscribe: "<mailto:unsub@directoryco.com>" }],
    [{ fromEmail: "newsletter@directoryco.com", subject: "October news" }],
  ])("refuses %o", (h) => expect(machineReason(h)).not.toBeNull());
  it("Auto-Submitted: no is a person", () => expect(machineReason({ ...person, autoSubmitted: "no" })).toBeNull());
});

describe("replyProblem — a reply never commits money, a meeting time or a signature", () => {
  it("passes a normal reply", () =>
    expect(replyProblem("Thanks Jane! Could you send your API docs and tell us whether service-area businesses are accepted?\n\nBest regards,")).toBeNull());
  it.each([
    "That works — $49 per listing is fine.",
    "We can do 300 USD a year.",
    "We will pay the setup fee once the contract arrives.",
    "We'd be happy to sign the agreement.",
    "Please send us an invoice.",
    "Here are our credit card details.",
    "We'll review the order form and card-on-file.",
    "We've signed the contract.",
    "Does Tuesday at 2 work for a call?",
    "Let's talk at 3:30 pm.",
  ])("refuses %s", (r) => expect(replyProblem(r)).not.toBeNull());
  it("refuses an empty reply", () => expect(replyProblem("  ")).not.toBeNull());
  it("the holding reply passes its own check", () => expect(replyProblem(holdingReply("Jane"))).toBeNull());
});

describe("helpers", () => {
  it("first names", () => {
    expect(firstNameOf("Jane Doe")).toBe("Jane");
    expect(firstNameOf("\"nicole rossi\"")).toBe("Nicole");
    expect(firstNameOf("Partnerships Team")).toBeNull();
    expect(firstNameOf("jane@x.com")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
  it("company domains — free mail is nobody's company", () => {
    expect(companyDomain("NicoleR@mail.accessnewswire.com")).toBe("accessnewswire.com");
    expect(companyDomain("bob@gmail.com")).toBeNull();
    expect(companyDomain("x@shop.example.co.uk")).toBe("example.co.uk");
  });
  it("subjects get Re: once", () => {
    expect(replySubject("Partnership")).toBe("Re: Partnership");
    expect(replySubject("RE: Partnership")).toBe("RE: Partnership");
  });
  it("strips quoted history", () => {
    const t = "Sounds good, send the docs.\n\nOn Wed, Oct 14, 2026 at 10:56 AM ConstructHUB <media@constructhub.us> wrote:\n> Hi\n> old";
    expect(stripQuoted(t)).toBe("Sounds good, send the docs.");
    expect(stripQuoted("Yes.\n\nFrom: ConstructHUB <media@constructhub.us>\nSent: Wednesday\nTo: x")).toBe("Yes.");
  });
  it("signs as the Construct HUB Media Team", () => {
    const m = composeMail("Hello", "media@constructhub.us");
    expect(m.text).toContain("Construct HUB Media Team");
    expect(m.text).toContain("media@constructhub.us");
    expect(m.html).toContain("Construct HUB Media Team");
    expect(m.html).not.toContain("support@constructhub.us");
  });
});

describe("parseDecision", () => {
  it("clamps unknown kinds and stages", () => {
    const d = parseDecision(JSON.stringify({ reply: "Hi", kind: "spaceship", stage: "married", needs_owner: true, owner_question: "Fee?" }));
    expect(d.kind).toBe("other");
    expect(d.stage).toBe("talking");
    expect(d.needsOwner).toBe(true);
    expect(d.relevant).toBe(true);
  });
  it("throws without a reply", () => expect(() => parseDecision(JSON.stringify({ kind: "news" }))).toThrow());
  it("reads fenced JSON", () => expect(parseDecision("```json\n{\"reply\":\"Hi\",\"stage\":\"agreed\",\"kind\":\"directory\"}\n```").stage).toBe("agreed"));
});

describe("AI providers — our API first, then OpenAI, then Anthropic", () => {
  it("orders TruthCoder, TruthCoder 2.0, OpenAI, Anthropic and skips keyless ones", async () => {
    const { mediaAiProviders } = await import("./ai");
    const env = { AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:8250/api/", AI_INTEGRATIONS_OPENAI_API_KEY: "a", AI_MODEL: "truthcode-api",
      TRUTHCODER_API_KEY: "b", HUB_OPENAI_API_KEY: "c" } as any;
    const p = mediaAiProviders(env);
    expect(p.map((x) => x.name)).toEqual(["TruthCoder", "TruthCoder 2.0", "OpenAI"]);
    expect(p[0].url).toBe("http://127.0.0.1:8250/api/chat/completions");
    expect(p[1].model).toBe("truthcoder:2.0");
    expect(mediaAiProviders({ ...env, ANTHROPIC_API_KEY: "d" }).at(-1)?.name).toBe("Anthropic");
  });
  it("falls through to the next provider when one fails", async () => {
    const { aiDeps, decide } = await import("./ai");
    const seen: string[] = [];
    const orig = aiDeps.fetch;
    aiDeps.fetch = async (url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model;
      seen.push(model);
      if (model === "truthcode-api") return new Response("down", { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: "Hi", kind: "news", stage: "talking" }) } }] }));
    };
    try {
      const d = await decide([{ direction: "in", from: "a@b.com", at: "x", subject: "s", body: "b" }],
        { AI_INTEGRATIONS_OPENAI_BASE_URL: "http://tc/api", AI_INTEGRATIONS_OPENAI_API_KEY: "a", AI_MODEL: "truthcode-api", TRUTHCODER_API_KEY: "b" } as any);
      expect(seen).toEqual(["truthcode-api", "truthcoder:2.0"]);
      expect(d.provider).toBe("TruthCoder 2.0 (truthcoder:2.0)");
    } finally { aiDeps.fetch = orig; }
  });
});
