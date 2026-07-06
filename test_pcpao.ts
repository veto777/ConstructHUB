import { chromium } from "playwright-core";

const CHROMIUM_PATH = "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

async function testPCPAO() {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  
  console.log("Navigating to PCPAO quick search...");
  await page.goto("https://www.pcpao.gov/quick-search", { waitUntil: "networkidle", timeout: 30000 });
  
  // Click on "Address" tab
  console.log("Page loaded. Looking for Address search tab...");
  const content = await page.content();
  
  // Let's check what tabs exist
  const tabs = await page.$$eval('a, button, li', els => els.map(e => ({
    tag: e.tagName,
    text: e.textContent?.trim()?.substring(0, 50),
    href: e.getAttribute('href'),
    class: e.className?.substring(0, 80)
  })).filter(e => e.text && ['address', 'owner', 'parcel', 'search'].some(w => e.text!.toLowerCase().includes(w))));
  console.log("Search-related elements:", JSON.stringify(tabs, null, 2));
  
  // Check for input fields
  const inputs = await page.$$eval('input[type="text"], input[type="search"], input:not([type])', els => els.map(e => ({
    id: e.id,
    name: e.getAttribute('name'),
    placeholder: e.getAttribute('placeholder'),
    class: e.className?.substring(0, 50),
    visible: e.offsetParent !== null
  })));
  console.log("Input fields:", JSON.stringify(inputs, null, 2));
  
  // Try to type in the search field
  const searchInput = await page.$('input#edit-search-api-fulltext, input[name*="search"], input[placeholder*="address" i], input[placeholder*="Address" i]');
  if (searchInput) {
    console.log("Found search input, typing address...");
    await searchInput.fill("2929 LEPRECHAUN");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(5000);
    
    // Check for results
    const resultsHtml = await page.evaluate(() => document.body.innerText.substring(0, 3000));
    console.log("Results text:", resultsHtml.substring(0, 2000));
  } else {
    console.log("No search input found. Checking full HTML...");
    // Check all input elements
    const allInputs = await page.$$eval('input', els => els.map(e => ({
      type: e.type,
      id: e.id,
      name: e.getAttribute('name'),
      placeholder: e.getAttribute('placeholder'),
    })));
    console.log("All inputs:", JSON.stringify(allInputs, null, 2));
  }
  
  await browser.close();
}

testPCPAO().catch(console.error);
