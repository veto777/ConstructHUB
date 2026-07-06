import { chromium, type Browser } from "playwright-core";

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

let browserInstance: Browser | null = null;
let launchPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  if (launchPromise) return launchPromise;
  launchPromise = (async () => {
    browserInstance = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu","--disable-extensions","--no-first-run","--js-flags=--max-old-space-size=256"],
    });
    browserInstance.on("disconnected", () => { browserInstance = null; launchPromise = null; });
    return browserInstance;
  })();
  try { return await launchPromise; } finally { launchPromise = null; }
}

export interface ScrapedBusiness {
  name: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  category: string | null;
  lat: number | null;
  lng: number | null;
  serviceAreaBusiness: boolean;
}

export async function scrapeGoogleMapsBusiness(opts: { name?: string | null; mapsUrl?: string | null; kgmid?: string | null }): Promise<ScrapedBusiness | null> {
  const { name, mapsUrl, kgmid } = opts;
  let url: string;
  if (mapsUrl && /google\.\w+\/maps/i.test(mapsUrl)) {
    url = mapsUrl;
  } else if (name) {
    const q = encodeURIComponent(name);
    url = kgmid
      ? `https://www.google.com/maps/search/${q}?kgmid=${encodeURIComponent(kgmid)}`
      : `https://www.google.com/maps/search/${q}`;
  } else {
    return null;
  }

  let page: any = null;
  let context: any = null;
  console.log("[gmaps-scraper] starting:", url);
  try {
    const browser = await getBrowser();
    console.log("[gmaps-scraper] browser ready");
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      locale: "en-US",
    });
    context.setDefaultTimeout(25000);
    context.setDefaultNavigationTimeout(25000);
    page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(4500);

    const finalUrl: string = page.url();
    let lat: number | null = null;
    let lng: number | null = null;
    const cm = finalUrl.match(/!3d([-\d.]+)!4d([-\d.]+)/) || finalUrl.match(/@([-\d.]+),([-\d.]+),/);
    if (cm) { lat = parseFloat(cm[1]); lng = parseFloat(cm[2]); }

    const evalSource = `(function() {
      var labels = [];
      var btns = document.querySelectorAll('button[aria-label]');
      for (var i = 0; i < btns.length; i++) {
        var l = btns[i].getAttribute('aria-label');
        if (l) labels.push(l);
      }
      var addressLabel = null, phoneLabel = null;
      for (var j = 0; j < labels.length; j++) {
        if (!addressLabel && /^Address:/i.test(labels[j])) addressLabel = labels[j];
        if (!phoneLabel && /^Phone:/i.test(labels[j])) phoneLabel = labels[j];
      }
      var websiteEl = document.querySelector('a[data-item-id="authority"]');
      var websiteAria = websiteEl ? websiteEl.getAttribute('aria-label') : null;
      var nameEl = document.querySelector('h1.DUwDvf') || document.querySelector('h1[class*="DUwDvf"]') || document.querySelector('h1');
      var categoryEl = document.querySelector('button[jsaction*="category"]') || document.querySelector('.DkEaL');
      var bodyText = (document.body && document.body.innerText) || '';
      var sabIndicator = /Service\\s+area|Serves\\s+nearby|Provides\\s+services/i.test(bodyText);
      var addr = addressLabel ? addressLabel.replace(/^Address:\\s*/i, '').trim() : null;
      var ph = phoneLabel ? phoneLabel.replace(/^Phone:\\s*/i, '').trim() : null;
      var wsite = (websiteEl && websiteEl.href) ? websiteEl.href : (websiteAria ? websiteAria.replace(/^Website:\\s*/i, '').trim() : null);
      return {
        name: nameEl && nameEl.textContent ? nameEl.textContent.trim() : null,
        address: addr,
        phone: ph,
        website: wsite,
        category: categoryEl && categoryEl.textContent ? categoryEl.textContent.trim() : null,
        sabIndicator: sabIndicator
      };
    })()`;
    const data = await page.evaluate(evalSource);

    return {
      name: data.name || name || null,
      address: data.address,
      phone: data.phone,
      website: data.website,
      category: data.category,
      lat,
      lng,
      serviceAreaBusiness: !data.address,
    };
  } catch (e: any) {
    console.error("[gmaps-scraper] failed:", e?.message || e);
    return null;
  } finally {
    try { if (page) await page.close(); } catch {}
    try { if (context) await context.close(); } catch {}
  }
}
