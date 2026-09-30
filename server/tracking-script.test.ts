import { describe, it, expect } from "vitest";
import { registerTrackingRoutes } from "./tracking-script";

/** The Click Guard embed exactly as GET /api/click-guard/script/:trackingId serves it. */
function servedScript(trackingId: string): string {
  const handlers: Record<string, (req: any, res: any) => void> = {};
  registerTrackingRoutes({ get: (path: string, handler: any) => { handlers[path] = handler; } } as any);
  let body = "";
  handlers["/api/click-guard/script/:trackingId"](
    { params: { trackingId } },
    { setHeader() {}, send(b: string) { body = b; }, json() {} },
  );
  return body;
}

type Sent = { url: string; init?: any; via: "fetch" | "xhr"; body: any };

/** Run the embed in a minimal fake browser and capture what it sends. */
function runEmbed(userAgent: string, opts: { withFetch?: boolean } = {}): Sent[] {
  const sent: Sent[] = [];
  const fetchStub = (url: string, init: any) => {
    sent.push({ url, init, via: "fetch", body: JSON.parse(init.body) });
    return Promise.resolve({ status: 204 });
  };
  class XhrStub {
    url = "";
    withCredentials = false;
    open(_m: string, url: string) { this.url = url; }
    setRequestHeader() {}
    send(body: string) { sent.push({ url: this.url, via: "xhr", body: JSON.parse(body), init: { withCredentials: this.withCredentials } }); }
  }
  const withFetch = opts.withFetch !== false;
  const win: any = { location: { href: "https://customer.example/landing" } };
  if (withFetch) win.fetch = fetchStub;
  const doc = { readyState: "complete", referrer: "", createElement: () => ({ getContext: () => null }) };
  new Function("window", "navigator", "document", "screen", "fetch", "XMLHttpRequest", servedScript("fixture-tid"))(
    win, { userAgent, language: "en-US" }, doc, { width: 390, height: 844 }, withFetch ? fetchStub : undefined, XhrStub,
  );
  return sent;
}

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

describe("Click Guard embed", () => {
  it("reports mobile operating systems instead of the desktop OS their user agents mention", () => {
    // iPhone/iPad UAs contain "like Mac OS X" and Android UAs contain "Linux".
    expect(runEmbed(UA.iphone)[0].body.os).toBe("iOS");
    expect(runEmbed(UA.ipad)[0].body.os).toBe("iOS");
    expect(runEmbed(UA.android)[0].body.os).toBe("Android");
    expect(runEmbed(UA.mac)[0].body.os).toBe("macOS");
    expect(runEmbed(UA.windows)[0].body.os).toBe("Windows");
    expect(runEmbed(UA.linux)[0].body.os).toBe("Linux");
  });

  it("sends one credential-less JSON POST, so the track route's wildcard CORS answer is accepted", () => {
    const sent = runEmbed(UA.windows);
    expect(sent).toHaveLength(1);
    expect(sent[0].via).toBe("fetch");
    expect(sent[0].url).toMatch(/\/api\/click-guard\/track$/);
    expect(sent[0].init).toMatchObject({ method: "POST", credentials: "omit", keepalive: true, headers: { "Content-Type": "application/json" } });
    expect(sent[0].body.trackingId).toBe("fixture-tid");
  });

  it("falls back to a non-credentialed XHR when fetch is unavailable", () => {
    const sent = runEmbed(UA.android, { withFetch: false });
    expect(sent).toHaveLength(1);
    expect(sent[0].via).toBe("xhr");
    expect(sent[0].init.withCredentials).toBe(false);
    expect(sent[0].body.os).toBe("Android");
  });
});
