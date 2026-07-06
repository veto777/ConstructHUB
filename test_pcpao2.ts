import { chromium } from "playwright-core";
const CHROMIUM_PATH = "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

async function testPCPAO() {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH, headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  
  // Intercept API calls
  const apiCalls: any[] = [];
  page.on('response', async (response) => {
    const url = response.url();
    if ((url.includes('/api') || url.includes('json') || url.includes('search') || url.includes('parcel') || url.includes('property')) 
        && !url.includes('.js') && !url.includes('.css') && !url.includes('.png') && !url.includes('.svg') && !url.includes('google')) {
      try {
        const ct = response.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const body = await response.text();
          apiCalls.push({ url: url.substring(0, 200), status: response.status(), bodyLength: body.length, bodyPreview: body.substring(0, 300) });
        } else {
          apiCalls.push({ url: url.substring(0, 200), status: response.status(), contentType: ct.substring(0, 50) });
        }
      } catch {}
    }
  });
  
  await page.goto("https://www.pcpao.gov/quick-search", { waitUntil: "networkidle", timeout: 30000 });
  
  const addrInput = await page.$('input[placeholder*="Address"]');
  if (!addrInput) { console.log("No addr input"); await browser.close(); return; }
  
  await addrInput.click();
  await addrInput.fill("16004 REDINGTON");
  
  // Use JavaScript to submit the form or trigger the search
  await page.evaluate(() => {
    const btn = document.querySelector('button[alt="Submit"]') as HTMLButtonElement;
    if (btn) btn.click();
  });
  
  await page.waitForTimeout(8000);
  
  console.log("API calls:", JSON.stringify(apiCalls, null, 2));
  
  const rows = await page.$$eval('table tbody tr', trs => trs.map(tr => {
    const cells = tr.querySelectorAll('td');
    return Array.from(cells).map(c => c.textContent?.trim()?.substring(0, 60)).join(' | ');
  }));
  console.log("\nTable rows:", rows.slice(0, 10));
  
  // Check for links to property-details
  const detailLinks = await page.$$eval('a[href*="property-details"]', links => 
    links.map(l => ({ text: l.textContent?.trim()?.substring(0, 80), href: l.getAttribute('href')?.substring(0, 100) }))
  );
  console.log("\nDetail links:", JSON.stringify(detailLinks, null, 2));
  
  if (detailLinks.length > 0) {
    const detailUrl = detailLinks[0].href!;
    const fullUrl = detailUrl.startsWith('http') ? detailUrl : `https://www.pcpao.gov${detailUrl}`;
    console.log("\nNavigating to:", fullUrl);
    await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 30000 });
    
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log("\n=== PROPERTY DETAIL PAGE (first 5000 chars) ===");
    console.log(bodyText.substring(0, 5000));
  }
  
  await browser.close();
}

testPCPAO().catch(console.error);
