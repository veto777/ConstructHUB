import fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendReviewReminderEmail, sendReviewRequestEmail } from "./email";

// Audit M3: client name, company name and the personal message were put into
// the review emails' HTML as typed. The dev sink captures what would be sent.
describe("review request emails escape what people typed", () => {
  let captured: any[] = [];
  const savedSink = process.env.EMAIL_FORCE_SINK;

  beforeEach(() => {
    captured = [];
    process.env.EMAIL_FORCE_SINK = "1";
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as any);
    vi.spyOn(fs, "appendFileSync").mockImplementation((_p: any, data: any) => { captured.push(JSON.parse(String(data))); });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (savedSink === undefined) delete process.env.EMAIL_FORCE_SINK;
    else process.env.EMAIL_FORCE_SINK = savedSink;
  });

  const company = `Smith & Sons <Roofing> "Best"`;
  const client = `Pat <b>O'Hara</b>`;

  it("the first request: message lines, greeting and sign-off are escaped in the HTML only", async () => {
    const message = `Hello\n<a href="https://evil.example">Confirm your account</a>\n\nThanks`;
    await sendReviewRequestEmail("pat@example.com", client, company, null, "tok", "https://app.example", undefined, message);
    expect(captured).toHaveLength(1);
    const { html, text, from } = captured[0];
    expect(html).not.toContain("<a href=\"https://evil.example\"");
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;Confirm your account&lt;/a&gt;");
    expect(html).toContain("Hi Pat &lt;b&gt;O&#39;Hara&lt;/b&gt;,");
    expect(html).toContain("Smith &amp; Sons &lt;Roofing&gt; &quot;Best&quot;</p>");
    expect(html).toContain(">&nbsp;</p>"); // an empty line still renders as a spacer
    expect(html).toContain('<a href="https://app.example/api/review/tok/click"'); // our own link is untouched
    expect(text).toContain(message); // plain text stays as typed
    expect(from).toMatch(/^"Smith & Sons\s+Roofing\s+Best" </);
  });

  it("the default body escapes the company name", async () => {
    await sendReviewRequestEmail("pat@example.com", client, company, null, "tok", "https://app.example");
    expect(captured[0].html).toContain("Thank you for choosing Smith &amp; Sons &lt;Roofing&gt; &quot;Best&quot; for");
  });

  it("the reminder escapes the greeting and sign-off", async () => {
    await sendReviewReminderEmail("pat@example.com", client, company, null, "tok", "https://app.example", 1);
    const { html, from } = captured[0];
    expect(html).toContain("Hi Pat &lt;b&gt;O&#39;Hara&lt;/b&gt;,");
    expect(html).toContain("Smith &amp; Sons &lt;Roofing&gt; &quot;Best&quot;</p>");
    expect(html).not.toContain("<b>");
    expect(from).not.toMatch(/"[^"]*[<>"][^"]*" </);
  });
});
