import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-migrate.tsx and server/crm/migrate.ts as they run. */
const entry: HelpDraft = {
  key: "crm-migrate", group: "CRM", route: "/crm/migrate", title: "Bring your clients from another system",
  whatItIs: "The import page: bring clients, then estimates and invoices, into the CRM from a CSV or TSV export of another system or a spreadsheet.",
  whatItDoes: "You pick what the file holds, choose the file and preview it. The CRM guesses which column is which and shows every row before anything is saved. Import then creates the rows and tells you how many were created, skipped as duplicates, or had errors.",
  howToUse: [
    "CRM → Clients → Import (or Settings → Import).",
    "Pick Clients, choose your CSV or TSV export, and choose Preview.",
    "Check the column mapping and the rows underneath; change a column's list if the guess is wrong.",
    "Choose Import, then View your clients.",
  ],
  howItWorks: "A file can be up to 2 MB and 5,000 rows. A client whose email or phone already exists in your CRM is skipped rather than duplicated, and nothing you already have is overwritten. Estimates and invoices are matched to clients you have already imported.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "A CSV or TSV file exported from your old system or spreadsheet."],
};
export default entry;
