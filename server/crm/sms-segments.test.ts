import { describe, expect, it } from "vitest";
import { SMS_SEGMENT_SIZES, smsEncoding, smsSegments } from "./sms-segments";

// The segment counter behind the monthly text allowance (audit A1-3): GSM-7
// 160/153 with two-septet extension characters, UCS-2 70/67 in UTF-16 units.
describe("sms segment counting (pure)", () => {
  it("detects the encoding from the whole body", () => {
    expect(smsEncoding("Reminder: estimate 1042 for $4,250.00 is waiting")).toBe("gsm7");
    expect(smsEncoding("Café ouvert à 9h — ñ ü")).toBe("ucs2"); // the em dash is not GSM-7
    expect(smsEncoding("Café ouvert à 9h, ñ ü €")).toBe("gsm7"); // € is in the extension table
    expect(smsEncoding("Thanks 👋")).toBe("ucs2");
    expect(smsEncoding("“smart quotes”")).toBe("ucs2");
    expect(smsEncoding("")).toBe("gsm7");
  });

  it("GSM-7: 160 in one segment, then 153 per segment", () => {
    const { single, multi } = SMS_SEGMENT_SIZES.gsm7;
    expect(smsSegments("")).toBe(1);
    expect(smsSegments("a".repeat(single))).toBe(1);
    expect(smsSegments("a".repeat(single + 1))).toBe(2);
    expect(smsSegments("a".repeat(multi * 2))).toBe(2);
    expect(smsSegments("a".repeat(multi * 2 + 1))).toBe(3);
    expect(smsSegments("a".repeat(1600))).toBe(11);
  });

  it("GSM-7 extension characters cost two", () => {
    expect(smsSegments("a".repeat(158) + "{")).toBe(1);
    expect(smsSegments("a".repeat(159) + "}")).toBe(2);
    expect(smsSegments("[" + "a".repeat(158) + "]")).toBe(2);
    expect(smsSegments("€".repeat(80))).toBe(1);
    expect(smsSegments("€".repeat(81))).toBe(2);
  });

  it("UCS-2: 70 in one segment, then 67 per segment, in UTF-16 code units", () => {
    const { single, multi } = SMS_SEGMENT_SIZES.ucs2;
    expect(smsSegments("—")).toBe(1);
    expect(smsSegments("a".repeat(single - 1) + "—")).toBe(1);
    expect(smsSegments("a".repeat(single) + "—")).toBe(2);
    expect(smsSegments("a".repeat(multi * 2 - 1) + "—")).toBe(2);
    expect(smsSegments("a".repeat(multi * 2) + "—")).toBe(3);
    // An emoji is a surrogate pair: 35 fit in one segment, 36 do not.
    expect(smsSegments("😀".repeat(35))).toBe(1);
    expect(smsSegments("😀".repeat(36))).toBe(2);
  });

  it("the production bodies land where the carrier bills them", () => {
    expect(smsSegments("Alpine Siding: reminder — estimate 1042 for $4,250.00 is waiting: https://constructhub.us/e/abc123?k=deadbeef")).toBe(2); // the em dash makes it UCS-2
    expect(smsSegments("Alpine Siding: reminder - estimate 1042 for $4,250.00 is waiting: https://constructhub.us/e/abc123?k=deadbeef")).toBe(1);
    expect(smsSegments("ConstructHub: you're opted in to account-notification texts (estimate opens, approvals, payments). Msg frequency varies. Msg&data rates may apply. Reply STOP to opt out, HELP for help.")).toBe(2);
  });
});
