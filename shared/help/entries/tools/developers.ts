import type { HelpDraft } from "../../types";

/** Written from client/src/pages/developers.tsx and the OpenAPI document the server publishes at /api/v1/openapi.json. */
const entry: HelpDraft = {
  key: "developers", group: "Tools", route: "/developers", title: "Developers (API reference)",
  whatItIs: "The public guide to the ConstructHUB API, the way other software talks to ConstructHUB. It is for your web developer: how to sign in, what each request costs, and every request with examples.",
  whatItDoes: "Authentication explains how to send your key and the read and write permissions a key can have; a CRM API card at the bottom covers the CRM’s own keys. Limits and units lists what a read and a write cost and each plan’s monthly units. Endpoints has one card per kind of data, with a search box, and each request shows what it may touch, its cost, what to send, what comes back and a ready-to-copy example. A banner says what the API does not do: it never reaches the AI features.",
  howToUse: [
    "Create a key in Settings → API keys (Manage API keys at the top of the page goes there).",
    "Send the key with every request, exactly as the Authentication card shows.",
    "Copy the example for the request you need and adapt it.",
    "Watch what your keys spend in Settings → API usage.",
  ],
  howItWorks: "The reference is built from ConstructHUB’s own description of each request. If that is not published, the page still shows sign-in, limits and the AI rules and says the reference is missing. Examples are made up from the request’s shape, never from any account’s data, and every request has a link you can share.",
  needs: ["Nothing to read it: the page is public. Calling the API needs a key from a plan that includes API units."],
};
export default entry;
