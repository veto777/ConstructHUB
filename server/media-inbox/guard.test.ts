import { describe, expect, it } from "vitest";
import { asksIfAi, companyDomain, firstNameOf, formMessage, holdingReply, personWillReply, machineReason, replyProblem, replySubject } from "./guard";
import { parseGoogleForm } from "./browse";
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
    "Our API key is sk-abcdefghijklmnopqrstu.",
    "Here is the password for our account.",
    "As an AI, I can't decide that.",
    "word ".repeat(260),
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
  it("signs as Leah Peterson of the Construct HUB Media Team", () => {
    const m = composeMail("Hello", "media@constructhub.us");
    expect(m.text).toContain("Leah Peterson, Partnerships\nConstruct HUB Media Team");
    expect(m.html).toContain("Leah Peterson");
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

describe("follow-ups", () => {
  it("the follow-up and the new-contact email pass the laws", async () => {
    const { followUpBody, newContactBody } = await import("./worker");
    const first = "Hi,\n\nConstructHUB is software for US contractors. Could you tell us how partner access works?\n\nBest regards,";
    const f = followUpBody("Sam", "City Listings", first);
    expect(f.startsWith("Hi Sam,")).toBe(true);
    expect(f).toContain("Our earlier email");
    expect(replyProblem(f)).toBeNull();
    const n = newContactBody("City Listings", first);
    expect(n.startsWith("Hi,\n\nWe tried to reach City Listings")).toBe(true);
    expect(n).not.toMatch(/Hi,\n\nWe tried[\s\S]*Hi,/);
    expect(replyProblem(n)).toBeNull();
  });
});

describe("opt-outs", () => {
  it.each(["stop", "STOP", "Please remove me from your list.", "Unsubscribe", "Not interested, thanks.", "Please don't email us again."])("%s is an opt-out", async (b) => {
    const { isOptOut } = await import("./guard");
    expect(isOptOut(b)).toBe(true);
  });
  it.each(["We'd love to work together. Our API docs are attached.", "Could you stop by our booth at the expo?"])("%s is not", async (b) => {
    const { isOptOut } = await import("./guard");
    expect(isOptOut(b)).toBe(false);
  });
  it("the first-contact email passes the laws and carries the stop line", async () => {
    const { firstContactBody } = await import("./worker");
    const b = firstContactBody("HomeFix Directory");
    expect(b).toContain('reply "stop"');
    expect(replyProblem(b)).toBeNull();
  });
});

describe("the first-contact queue only takes listings businesses", () => {
  it("leaves out government, associations, chambers; and member/HR/support-desk addresses", async () => {
    const { NOT_A_LISTINGS_BUSINESS, NOT_A_PARTNER_ADDRESS } = await import("./store");
    for (const d of ["nebraska.gov", "toledo.oh.gov", "attorneygeneral.gov", "dot.state.tx.us", "springfieldchamber.com", "americanfenceassociation.com", "Texas Association of Builders"])
      expect(NOT_A_LISTINGS_BUSINESS.test(d)).toBe(true);
    for (const d of ["citysquares.com", "hotfrog.com", "brownbook.net", "Manta"]) expect(NOT_A_LISTINGS_BUSINESS.test(d)).toBe(false);
    for (const e of ["membership@acca.org", "diversity&inclusion@toledo.oh.gov".replace("&inclusion", ""), "customersupport@samsunghvac.com", "hic@attorneygeneral.gov"])
      expect(NOT_A_PARTNER_ADDRESS.test(e)).toBe(true);
    for (const e of ["info@citysquares.com", "partners@tupalo.com", "sales@x.com"]) expect(NOT_A_PARTNER_ADDRESS.test(e)).toBe(false);
  });
});

describe("sending ramp and templates", () => {
  it("ramps 50 → +25 a day → 400, or follows MEDIA_OUTREACH_PER_DAY (0 pauses)", async () => {
    const { dailyAllowance } = await import("./worker");
    expect(dailyAllowance(0, {} as any)).toBe(50);
    expect(dailyAllowance(4, {} as any)).toBe(150);
    expect(dailyAllowance(100, {} as any)).toBe(400);
    expect(dailyAllowance(100, { MEDIA_OUTREACH_MAX_PER_DAY: "250" } as any)).toBe(250);
    expect(dailyAllowance(9, { MEDIA_OUTREACH_PER_DAY: "0" } as any)).toBe(0);
    expect(dailyAllowance(9, { MEDIA_OUTREACH_PER_DAY: "120" } as any)).toBe(120);
  });
  it("every template asks about an API, carries the stop line and passes the laws", async () => {
    const { QUEUE_TEMPLATES } = await import("./worker");
    for (const t of Object.values(QUEUE_TEMPLATES)) {
      const b = t.body("Example Site");
      expect(b).toMatch(/API/);
      expect(b).toContain('reply "stop"');
      expect(replyProblem(b)).toBeNull();
    }
  });
});

describe("classifySites — vetted directories sorted before any email", () => {
  it("keeps only given domains and known classes", async () => {
    const { aiDeps, classifySites } = await import("./ai");
    const orig = aiDeps.fetch;
    aiDeps.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sites: [
      { domain: "abcchamber.org", class: "chamber", name: "ABC Chamber of Commerce" }, { domain: "nari-x.org", class: "trade_association", name: "National Association of Remodelers" },
      { domain: "made-up.com", class: "listing_directory" }, { domain: "dir.com", class: "spaceship" },
    ] }) } }] }));
    try {
      const r = await classifySites([{ domain: "abcchamber.org", title: "Member Directory", homeTitle: "Home - ABC Chamber of Commerce" }, { domain: "nari-x.org", title: null, homeTitle: null }, { domain: "dir.com", title: null, homeTitle: null }],
        { AI_INTEGRATIONS_OPENAI_BASE_URL: "http://tc/api", AI_INTEGRATIONS_OPENAI_API_KEY: "a" } as any);
      expect([...r.classes]).toEqual([["abcchamber.org", "chamber"], ["nari-x.org", "trade_association"]]);
      // A name not on the site's titles is dropped (nothing made up).
      expect([...r.names]).toEqual([["abcchamber.org", "ABC Chamber of Commerce"]]);
    } finally { aiDeps.fetch = orig; }
  });
});

describe("queueClassified never cold-emails a listing-management vendor", () => {
  it("matches vendors and their sub-domains only", async () => {
    const { NOT_A_RELATIONSHIP } = await import("./store");
    for (const d of ["synup.com", "get.nicejob.com", "yext.com", "serviceagent.ai"]) expect(NOT_A_RELATIONSHIP.test(d)).toBe(true);
    for (const d of ["mozillachamber.org", "nariatlanta.org", "ezlocal.com"]) expect(NOT_A_RELATIONSHIP.test(d)).toBe(false);
  });
});

describe("formMessage — our first email, as a form message", () => {
  it("drops the greeting, the stop line and the sign-off", () => {
    const m = formMessage(`Hi Acme team,\n\nConstructHUB is software for US contractors.\n\nIf this isn't something you handle, reply "stop" and we won't email you again.\n\nBest regards,`);
    expect(m).toBe("ConstructHUB is software for US contractors.");
  });
});

describe("parseGoogleForm — a Google Form's questions and answer keys", () => {
  const data = [null, ["Intro", [
    [1, "Company Name:", null, 0, [[111, null, 1]]],
    [2, "Countries", null, 4, [[222, [["US"], ["Canada"]], 1]]],
  ], null, null, null, null, null, null, "Partner Form"], "/x", "Partner Form"];
  const html = `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(data)};</script>`;
  it("reads fields, options and the formResponse endpoint", () => {
    const g = parseGoogleForm(html, "https://docs.google.com/forms/d/e/abc/viewform?usp=send_form")!;
    expect(g.fields).toEqual([
      { key: "entry.111", label: "Company Name:", type: "text", required: true },
      { key: "entry.222", label: "Countries", type: "checkbox-group", required: true, options: ["US", "Canada"] },
    ]);
    expect(g.googleForm?.action).toBe("https://docs.google.com/forms/d/e/abc/formResponse");
  });
  it("returns null for a page that is not a Google Form", () => expect(parseGoogleForm("<html></html>", "https://x.com")).toBeNull());
});

describe("asksIfAi — a direct question goes to a person", () => {
  it.each(["Hi, is this because you're an AI?", "Are you a bot?", "Is this a real person?", "was this written by AI?", "Are these emails automated?"])("%s", (q) => expect(asksIfAi(q)).toBe(true));
  it.each(["We use AI tools for our listings.", "Our API is open to partners.", "Are you available Tuesday?"])("not: %s", (q) => expect(asksIfAi(q)).toBe(false));
  it("the holding answer neither mentions AI nor claims a person wrote it", () => expect(replyProblem(personWillReply("Mike"))).toBeNull());
  it("a draft claiming to be human is refused", () => expect(replyProblem("Hi, I'm a real person on the team.\n\nBest regards,")).toMatch(/person wrote/));
});
