/**
 * The pronunciation lexicon (scripts/tutorials/lexicon.ts): it changes what the voice engine reads,
 * never what is written — and every committed step script is safe to speak.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { LEXICON, LEXICON_VERSION, lexiconChanges, spokenText, ttsCacheName, unlexiconedBrandTerms } from "../../scripts/tutorials/lexicon";
import { sentencesOf, sha256, splitCaption } from "../../scripts/tutorials/lib";

const VERB = "[Construct](/kənstɹˈʌkt/) Hub";

describe("pronunciation lexicon", () => {
  it("speaks the brand with the verb's stress, in every spelling and position", () => {
    expect(spokenText("Welcome to ConstructHUB.")).toBe(`Welcome to ${VERB}.`);
    expect(spokenText("This is Clients in the ConstructHUB CRM.")).toBe(`This is Clients in the ${VERB} CRM.`);
    expect(spokenText("a calendar named ConstructHub CRM")).toBe(`a calendar named ${VERB} CRM`);
    expect(spokenText("Construct Hub and construct-hub")).toBe(`${VERB} and ${VERB}`);
    expect(spokenText("ConstructHUB's menu")).toBe(`${VERB}'s menu`);
  });
  it("speaks the address", () => {
    expect(spokenText("Start at ConstructHUB dot U S.")).toBe(`Start at ${VERB} dot U S.`);
    expect(spokenText("Start at constructhub.us.")).toBe(`Start at ${VERB} dot U S.`);
  });
  it("leaves every other line exactly as written", () => {
    for (const t of ["Choose the JobCam tab.", "Once HOVER is connected, its reports land in the CRM.", "Export CSV gives you every client.", "They construct a hub."]) {
      expect(spokenText(t)).toBe(t);
      expect(lexiconChanges(t)).toBe(false);
    }
  });
  it("never changes the caption text — captions are cut from the written line", () => {
    const line = "This is Home in the ConstructHUB CRM. It shows where your business stands today.";
    const cues = sentencesOf(line).flatMap((s) => splitCaption(s));
    expect(cues.join(" ")).toBe(line);
    expect(cues.join(" ")).not.toMatch(/\[|\]\(|ɹ/);
  });
  it("keys the cache on the lexicon version for a changed line, and on the old key for an unchanged one", () => {
    const plain = "Choose the JobCam tab.";
    expect(ttsCacheName("janice", plain)).toBe(`${sha256(`janice\n${plain}`).slice(0, 32)}.wav`);
    const brand = "Welcome to ConstructHUB.";
    expect(ttsCacheName("janice", brand)).not.toBe(`${sha256(`janice\n${brand}`).slice(0, 32)}.wav`);
    expect(ttsCacheName("janice", brand)).toBe(`${sha256(`janice\nlexicon ${LEXICON_VERSION}\n${spokenText(brand)}`).slice(0, 32)}.wav`);
    expect(ttsCacheName("mike", brand)).not.toBe(ttsCacheName("janice", brand));
  });
  it("is idempotent in what it flags: a lexiconed line has no brand term left for the engine's own rules", () => {
    expect(unlexiconedBrandTerms("In the ConstructHUB CRM, at constructhub.us.")).toEqual([]);
    expect(unlexiconedBrandTerms("Choose the JobCam tab.")).toEqual([]);
  });
  it("flags a brand name in a spelling it does not know, and markup typed into a script", () => {
    expect(unlexiconedBrandTerms("Welcome to Con struct HUB.")).not.toEqual([]);
    expect(unlexiconedBrandTerms("Welcome to ConstruktHub.")).not.toEqual([]);
    expect(unlexiconedBrandTerms("Welcome to KonstructHub.")).not.toEqual([]);
    expect(unlexiconedBrandTerms("All your ConstructHUBs.")).not.toEqual([]);
    expect(unlexiconedBrandTerms(`Welcome to ${VERB}.`)).not.toEqual([]);
  });
  it("has entries that each change something and never loop", () => {
    for (const e of LEXICON) {
      expect(e.match.global).toBe(true);
      expect(spokenText(e.term)).not.toBe(e.term);
      expect(spokenText(spokenText(e.term))).toBe(spokenText(e.term));
    }
  });
  it("every committed step script is safe to speak", () => {
    const dir = path.resolve(import.meta.dirname, "../../docs/tutorials/scripts");
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const script = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { steps: { narration: string }[] };
      for (const s of script.steps) expect(unlexiconedBrandTerms(s.narration), `${f}: ${s.narration}`).toEqual([]);
    }
  });
});
