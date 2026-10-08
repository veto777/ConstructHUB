/**
 * Imported FIRST by server/index.ts, for its side effect: a process that asks for tutorial
 * fixtures outside a recording slot stops here, before a route, a database pool or a provider
 * client exists. See gate.ts.
 */
import { assertTutorialFixturesBootable, tutorialFixturesOn } from "./gate";

try {
  assertTutorialFixturesBootable();
} catch (e) {
  console.error(`\n${e instanceof Error ? e.message : e}\n`);
  process.exit(78); // EX_CONFIG
}
if (tutorialFixturesOn()) console.warn(`⚠️  TUTORIAL FIXTURES ARE ON (recording slot ${process.env.TUTORIAL_SLOT}) — provider data on this server is fictional. Never expose this process.`);
