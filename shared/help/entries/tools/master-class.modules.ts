import type { HelpDraft } from "../../types";

/** Written from client/src/pages/master-class.tsx, client/src/components/master-class/* and server/master-class/routes.ts as they run. */
const entry: HelpDraft = {
  key: "master-class.modules", parent: "master-class", group: "Tools", route: "/master-class", title: "Master Class → Modules",
  whatItIs: "The four course modules and the bonus lessons: Business Formation & Licensing, Google Business, Website, SEO & ads, and Vetting contractors.",
  whatItDoes: "Each module tab is a home for its lessons: an outline, the lessons in order, and a link to the ConstructHUB tool each lesson is about. A module you own opens its full lesson text; one you do not shows what it covers and a way to enroll. The Vetting contractors lessons open with any module.",
  howToUse: [
    "Pick a module tab: State guide, Google Business, Website or SEO & ads; a lock on the tab means it is not unlocked on this account yet.",
    "Read the lessons in order; the address keeps the open lesson, so you can come back to it.",
    "Choose Enroll if a module is locked to see the modules and the bundle.",
  ],
  howItWorks: "The page asks the server once which modules this account may read; the answer is worked out per module from purchases, the bundle or a plan that includes the course. Lesson text is not in the app download: a module loads it only when it is open and only for an account that may read it. While the access check is loading or has failed the page says so instead of treating it as “not bought”.",
  needs: ["A Master Class purchase (a module or the bundle) or a plan that includes the course."],
};
export default entry;
