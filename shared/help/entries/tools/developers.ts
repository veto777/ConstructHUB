import type { HelpDraft } from "../../types";

/** Written from client/src/pages/developers.tsx and the OpenAPI document the server publishes at /api/v1/openapi.json. */
const entry: HelpDraft = {
  key: "developers", group: "Tools", route: "/developers", title: "Developers (API reference)",
  whatItIs: "The public reference for the ConstructHUB API (the way software talks to ConstructHUB): how to sign requests, what each call costs, and every call with its parameters, schemas, examples and a curl line.",
  whatItDoes: "Authentication explains the bearer header and the two key types. Limits and units lists what a read and a write cost and each plan’s monthly units. Endpoints is generated from /api/v1/openapi.json: one card per resource, a search over method, path and summary, and for every operation its scope, cost, parameters, request and response schemas, an example body and response built from the schemas, and a curl command. A banner says what the API does not do: it never reaches the AI features.",
  howToUse: [
    "Create a key in Settings → API keys (Manage API keys at the top of the page goes there).",
    "Send it as Authorization: Bearer <key> to the /api/v1 base; the Authentication card shows the exact header.",
    "Find the endpoint in the reference, copy its curl line or example body, and adapt it.",
    "Watch what your keys spend in Settings → API usage.",
  ],
  howItWorks: "The reference is read from the OpenAPI document the server assembles from each resource; when it is not published the page still shows authentication, limits and the AI rules and says the reference is missing. Examples are built from the schemas, never from any account’s data. Every endpoint has a stable anchor (#get-locations-id) you can share.",
  needs: ["Nothing to read it: the page is public. Calling the API needs a key from a plan that includes API units."],
};
export default entry;
