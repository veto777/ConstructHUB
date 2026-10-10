/**
 * Regenerate shared/scrapable-platforms.ts from the adapter registry so the client-side
 * canScrapeGovernmentPortal() agrees with what the server can actually scrape.
 *
 * Run after adding/removing an adapter: npx tsx scripts/sync-scrapable-platforms.ts
 * server/scrapers/registry.test.ts fails when the generated file is stale.
 */
import { writeFileSync } from "fs";
import { renderScrapablePlatformsModule } from "../server/scrapers/registry";

writeFileSync("shared/scrapable-platforms.ts", renderScrapablePlatformsModule());
console.log("wrote shared/scrapable-platforms.ts");
