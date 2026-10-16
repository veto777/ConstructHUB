import type { HelpDraft } from "../../types";

/** Written from client/src/components/social-week.tsx (the Calendar view) as it runs. */
const entry: HelpDraft = {
  key: "social-media.calendar", parent: "social-media", group: "Tools", route: "/social-media", title: "Social Media → Calendar",
  whatItIs: "A week of posts, day by day, for one business or for all clients.",
  whatItDoes: "It shows seven days with each post’s network, time, status and the start of its text; today is marked. Previous week, Today and Next week move the week, and a day with more posts than fit links to the Posts list. New post opens the composer for the business.",
  howToUse: [
    "Open Calendar; the current week is shown with today marked.",
    "Use Previous week and Next week to look ahead or back, and Today to return.",
    "Read a day’s posts; a +N more link opens the full list under Posts.",
    "Choose New post to add a post for the business.",
  ],
  howItWorks: "Each day is read from the same Posts list, narrowed to that day in your browser’s timezone, so the calendar and the list always agree. The week refreshes once a minute. In the all-clients view each post also names its business.",
};
export default entry;
