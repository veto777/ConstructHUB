import { chromium } from "playwright-core";
const CHROMIUM_PATH = "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

async function testPCPAO() {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH, headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  
  // Intercept API calls to find their data source
  page.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('json') && !url.includes('google')) {
      try {
        const body = await response.text();
        if (body.length > 10) {
          console.log(`JSON API: ${url.substring(0, 150)} (${body.length} bytes)`);
          if (body.length < 1000) console.log(`  Body: ${body.substring(0, 500)}`);
        }
      } catch {}
    }
  });
  
  await page.goto("https://www.pcpao.gov/quick-search", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  
  const addrInput = await page.$('input[placeholder*="Address"]');
  if (!addrInput) { console.log("No addr input"); await browser.close(); return; }
  
  await addrInput.click();
  await addrInput.fill("16004 REDINGTON");
  // Submit via JS
  await page.evaluate(() => {
    const form = document.querySelector('input[placeholder*="Address"]')?.closest('form');
    if (form) { form.submit(); return; }
    const btn = document.querySelector('button[alt="Submit"]') as HTMLElement;
    if (btn) btn.click();
  });
  
  await page.waitForTimeout(10000);
  
  // Check results table
  const text = await page.evaluate(() => {
    const table = document.querySelector('.dataTable, #DataTables_Table_0, table');
    return table ? table.textContent?.substring(0, 2000) : 'no table found';
  });
  console.log("\nTable content:", text?.substring(0, 1000));
  
  // Check for property-details links
  const links = await page.$$eval('a[href*="property-details"]', els => 
    els.map(e => e.getAttribute('href')?.substring(0, 120))
  );
  console.log("\nProperty detail links:", links);
  
  await browser.close();
}

testPCPAO().catch(console.error);
