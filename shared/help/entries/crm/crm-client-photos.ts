import type { HelpDraft } from "../../types";

/** Written from client/src/components/client-uploads.tsx (CustomerPhotos) as it runs on a client's page. */
const entry: HelpDraft = {
  key: "crm-client-photos", group: "CRM", route: "/crm/clients", title: "Keep before-and-after photos on a client",
  whatItIs: "The Project Photos section of a client's page: in-progress and finished shots of their job, kept with the client.",
  whatItDoes: "You choose In progress or Finished, then add photos; each one is tagged with the stage you chose. Photos the client shares from their portal land in the same section, and the client sees these photos in their portal.",
  howToUse: [
    "CRM → Clients, open the client and scroll to Project Photos.",
    "Leave the list on “In progress”, choose “Add photos” and pick the photos.",
    "Switch the list to “Finished” and add the after shots the same way.",
    "To remove one, point at the photo and choose the bin.",
  ],
  howItWorks: "JPEG, PNG, HEIC and WebP photos are accepted, up to 20 in one go. Deleting a photo removes it from the client's portal too.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
