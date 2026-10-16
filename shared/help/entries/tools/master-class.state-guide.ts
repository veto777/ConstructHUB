import type { HelpDraft } from "../../types";

/** Written from client/src/pages/master-class.tsx and client/src/components/master-class/state-guide.tsx as they run. */
const entry: HelpDraft = {
  key: "master-class.state-guide", parent: "master-class", group: "Tools", route: "/master-class", title: "Master Class → State guide",
  whatItIs: "The first module’s home: your state’s business formation, licensing, workers’ comp and tax agencies, in the order to deal with them.",
  whatItDoes: "Choose a state and the guide names its filing office, licensing board, workers’ comp and tax agencies, each with its checked link where there is one. It says whether a statewide contractor license, a bond, workers’ comp and sales tax on labor apply, and puts the steps in a checklist. The Overview tab’s “Compare all 50 states” table shows the same key facts side by side and opens a state when you pick its row.",
  howToUse: [
    "Open the State guide tab, or choose Choose your state on the Overview, and pick your state.",
    "Read the agencies and the checklist; an agency with a checked link opens its site, and one without opens a web search for it.",
    "Open the lessons of the Business Formation & Licensing module under the guide once the module is unlocked.",
  ],
  howItWorks: "Each state's key facts (license, bond, workers’ comp, taxes on labor, filing office) are free to read. The full guide (agency links, notes, the checklist) and the module’s lessons open only for an account that owns the Business Formation & Licensing module, the bundle or a plan that includes the course. Agency links come from the state's own records and were last checked on Sep 30, 2026. A link the check could not confirm is marked “Link unconfirmed”, and none is ever guessed. The chosen state and tab stay in the page address, so a reload or a shared link returns to the same place.",
  needs: ["Each state's key facts are free. The full state guide and the module’s lessons need the Business Formation & Licensing module, the bundle, or a plan that includes the course."],
};
export default entry;
