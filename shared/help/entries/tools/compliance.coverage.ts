import type { HelpDraft } from "../../types";

/** Written from client/src/pages/compliance-research-coverage.tsx, server/research/coverage-manifest.ts and shared/research-coverage.ts as they run. */
const entry: HelpDraft = {
  key: "compliance.coverage", parent: "compliance", group: "Tools", route: "/compliance", title: "Compliance Dept → What a report searches",
  whatItIs: "The state-by-state list of every official source a research report checks, so you know what a report can and cannot find before you order one.",
  whatItDoes: "Pick a state to see its sources grouped by kind, such as license records, complaints, stop-work orders, debarments and business filings. Each source names and links the agency, lists what it can be searched by (business name, owner, license number, phone or address), and says whether it is a downloaded official file or searched live when a report runs. A state with no usable source says so, with how many of its sources were checked and could not be used. “In every state” lists what every report gets: the live permit portals in the chosen states, the nationwide records ConstructHUB holds, and the links between related licenses and businesses.",
  howToUse: [
    "Choose “What we search in each state” on the Compliance Dept, or “See exactly what we search in your state” on the order form.",
    "Choose a state from the grid (or the dropdown on a phone) to see its sources.",
    "Read the “Found by” chips on a source to see which identifiers work there, then order a report if it covers what you need.",
  ],
  howItWorks: "The list is made from the research bot’s own list of sources, so the page cannot promise a source the bot does not search. It changes when the bot does. For downloaded files, the “Found by” chips are read from the file’s loaded rows when the server can answer, otherwise from the built-in list. Complaints, enforcement and court records are searched for companies only, never for individual people.",
};
export default entry;
