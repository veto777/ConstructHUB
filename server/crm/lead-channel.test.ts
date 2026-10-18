import { describe, expect, it } from "vitest";
import { leadChannel, leadTracking } from "./lead-channel";

// Pure: no DB, no server. `npx vitest run server/crm/lead-channel.test.ts`

const lead = (over: Partial<Parameters<typeof leadChannel>[0]>) => ({ source: "form_sync", sourceLabel: "alpineexteriorswa.com · contact", pageUrl: "https://www.alpineexteriorswa.com/contact/", fields: null, message: null, ...over });

describe("leadChannel", () => {
  it("phone calls: the Call Assistant and the historical AI receptionist entries", () => {
    expect(leadChannel({ source: "call_assistant", sourceLabel: "Main line" })).toEqual({ key: "phone", label: "Phone call", detail: null });
    expect(leadChannel({ source: "import", fields: { flags: "form_id=ai-phone-janice: created by the AI phone receptionist" } }))
      .toEqual({ key: "phone", label: "Phone call", detail: "AI receptionist" });
    expect(leadChannel({ source: "import", message: "VIRTUAL FORM — filled out by Janice" }).key).toBe("phone");
    expect(leadChannel({ source: "manual" })).toEqual({ key: "manual", label: "Added by hand", detail: null });
  });

  it("Google Ads from a click id in the fields, the page URL or the landing URL; Google search from the referrer", () => {
    expect(leadChannel(lead({ fields: { _gclid: "EAIa", _utm_campaign: "siding-skagit" } }))).toEqual({ key: "google_ads", label: "Google Ads", detail: "siding-skagit" });
    expect(leadChannel(lead({ pageUrl: "https://alpineexteriorswa.com/contact/?gclid=EAIa" })).key).toBe("google_ads");
    expect(leadChannel(lead({ fields: { _landing: "https://alpineexteriorswa.com/?wbraid=x" } })).key).toBe("google_ads");
    expect(leadChannel(lead({ fields: { utm_source: "google", utm_medium: "cpc" } })).key).toBe("google_ads");
    expect(leadChannel(lead({ fields: { _referrer: "https://www.google.com/" } }))).toEqual({ key: "google", label: "Google", detail: null });
    expect(leadChannel(lead({ fields: { utm_source: "google", utm_medium: "organic" } })).key).toBe("google");
  });

  it("Meta: fbclid alone is a Facebook click, a paid medium makes it Meta Ads", () => {
    expect(leadChannel(lead({ fields: { _fbclid: "IwAR" } }))).toEqual({ key: "facebook", label: "Facebook", detail: null });
    expect(leadChannel(lead({ fields: { _fbclid: "IwAR", _utm_medium: "paid", _utm_source: "facebook" } })).key).toBe("meta_ads");
    expect(leadChannel(lead({ fields: { utm_source: "ig", utm_medium: "paid_social" } })).key).toBe("meta_ads");
    expect(leadChannel(lead({ fields: { utm_source: "instagram" } })).label).toBe("Instagram");
    expect(leadChannel(lead({ fields: { _referrer: "https://l.facebook.com/l.php?u=x" } })).key).toBe("facebook");
  });

  it("Bing, Yelp, Nextdoor, Angi and an unknown utm_source", () => {
    expect(leadChannel(lead({ fields: { msclkid: "abc" } })).label).toBe("Microsoft Ads");
    expect(leadChannel(lead({ pageUrl: "https://stpetesidingco.com/?utm_source=yelp&utm_medium=referral" })).label).toBe("Yelp");
    expect(leadChannel(lead({ fields: { _referrer: "https://nextdoor.com/p/abc" } })).key).toBe("nextdoor");
    expect(leadChannel(lead({ fields: { _referrer: "https://www.homeadvisor.com/rated.x" } })).label).toBe("Angi");
    expect(leadChannel(lead({ fields: { utm_source: "local_mailer", utm_campaign: "spring" } }))).toEqual({ key: "campaign", label: "Local mailer", detail: "spring" });
  });

  it("the site itself, an empty referrer or no trail at all is Website; another site is a referral", () => {
    expect(leadChannel(lead({ fields: { _referrer: "https://alpineexteriorswa.com/siding/" } }))).toEqual({ key: "website", label: "Website", detail: null });
    expect(leadChannel(lead({ fields: { _referrer: "" } })).key).toBe("website");
    expect(leadChannel(lead({ fields: { name: "Pat" } })).key).toBe("website");
    expect(leadChannel({ source: "import", fields: { site: "alpinesidingpros.net", flags: 'Elementor form "contact form"' } }).key).toBe("website");
    expect(leadChannel(lead({ fields: { _referrer: "https://www.skagitbuilders.example/partners" } }))).toEqual({ key: "referral", label: "Referral", detail: "skagitbuilders.example" });
  });

  it("leadTracking reads fields first, then the URLs, ignoring prefixes and case", () => {
    expect(leadTracking({ source: "form_sync", fields: { "_UTM_Source": "yelp", "HTTP_REFERER": "https://yelp.com/" }, pageUrl: "https://x.example/?utm_source=google" }))
      .toEqual({ utm_source: "yelp", referer: "https://yelp.com/" });
  });
});
