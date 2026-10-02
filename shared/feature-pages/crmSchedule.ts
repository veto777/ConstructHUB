import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";

/**
 * Schedule — the CRM's company calendar (/crm/schedule).
 *
 * Every claim below is backed by the code in `sources`:
 *   - month / week / agenda views, click a day to book, click a visit to edit, a crowded month cell
 *     opens the week: client/src/pages/crm-schedule.tsx
 *   - Everyone's calendar / My calendar / one teammate's: client/src/pages/crm-schedule.tsx (scope select)
 *   - the visit form (title, date, start/end or all day, project, client, crew, notes), shared with the
 *     client page: client/src/components/crm-appointment-form.tsx
 *   - crew conflict warning on booking: server/crm/schedule.ts POST /api/crm/appointments (conflicts)
 *   - booking needs manageJobs; a member without viewAllJobs sees only visits they're on or booked:
 *     server/crm/schedule.ts; role defaults: shared/schema.ts CRM_ROLE_DEFAULTS
 *   - the company iCal feed (token is the auth, regenerate kills old copies, manageSettings) and the
 *     Google Calendar push on "Sync now" into a "ConstructHub CRM" calendar, company-wide or per member:
 *     server/crm/calendar.ts, server/crm/ical.ts, client/src/pages/crm-settings.tsx, client/src/pages/crm-team.tsx
 *   - no client booking, no client appointment reminders: nothing in server/crm sends an appointment to a client
 * Numbers that live in the price book are read from it (allowanceLine), never typed.
 */

const SEATS: FeatureAllowance = { limit: "crmSeats", unit: "CRM seats", period: "count" };

const page: FeaturePage = {
  key: "crmSchedule",
  slug: "crm-schedule",
  group: "run",
  status: "ready",
  title: "Schedule",
  kicker: "Crew calendar",
  headline: { lead: "Every Visit and Every Crew on ", swipe: "One\u00a0Calendar" },
  lede:
    "Schedule is your CRM's company calendar. Book appointments and crew visits, tie each one to its client and " +
    "project, and send the schedule to the calendar apps your team already uses.",
  hero: { mascot: "standing", bubble: "Who's on which job Thursday? Let's look." },
  steps: [
    {
      title: "Book the visit",
      body: "Click a day and add a title, the time or all day, the project or client it's for, and notes.",
    },
    {
      title: "Pick the crew",
      body: "Tick the people going. If one of them is already on another visit at that time, you get a warning as you book it.",
    },
    {
      title: "Everyone sees their part",
      body: "Switch between everyone's calendar, your own, or one teammate's. Crew members without access to every job see only the visits they're on.",
    },
    {
      title: "Put it on their phones",
      body: "Subscribe a calendar app to the company feed, or connect Google Calendar and push the schedule there.",
    },
  ],
  cards: [
    {
      icon: "calendar",
      title: "Month, week and agenda views",
      body: "Scroll the calendar, click a day to book, click a visit to move it. A busy day in the month view opens the week so nothing is hidden.",
    },
    {
      icon: "users",
      title: "The right crew on each visit",
      body: "Assign people per visit, so a job with three visits can have a different crew for each one.",
    },
    {
      icon: "alert",
      title: "Crew conflict warnings",
      body: "Book someone who is already on another visit at that time and Schedule tells you how many conflicts there are before the day goes wrong.",
    },
    {
      icon: "link",
      title: "Tied to the job",
      body: "Visits link to a project and a client, and can be booked, changed or removed from the client's page as well as the calendar.",
    },
    {
      icon: "refresh",
      title: "A feed for any calendar app",
      body: "One private subscription link for the whole company's schedule, for Apple Calendar, Outlook, Google and other apps. Regenerate it and old copies stop working.",
    },
    {
      icon: "cloud",
      title: "Google Calendar push",
      body: "Connect Google and press Sync now: visits go to a ConstructHub CRM calendar, with edits and deletions carried over. Each team member can connect their own for only their visits.",
    },
  ],
  audience: [
    {
      title: "Owners who dispatch crews",
      body: "See who is where this week, and catch a double-booking when you make it rather than on the job site.",
    },
    {
      title: "Field crews",
      body: "Their own visits on the phone calendar they already use, without seeing the rest of the business.",
    },
    {
      title: "Offices with one scheduler",
      body: "One person books for everyone, and each crew member's calendar follows along.",
    },
  ],
  pricing: {
    kind: "plan",
    note: "Schedule is part of ConstructHub CRM; your plan's CRM seats decide how many people can be on it.",
  },
  faqs: [
    {
      q: "What do I need to use it?",
      a: "A ConstructHUB plan and your CRM workspace. To put people on visits, invite them to your CRM team. Google Calendar sync needs a Google account; the company feed works with any calendar app that can subscribe to a link.",
    },
    {
      q: "Which plans include it?",
      a: `Every plan, as part of ConstructHub CRM. How many people can use it is your CRM seats: ${allowanceLine(SEATS)}.`,
    },
    {
      q: "Who can book and move visits?",
      a: "Anyone whose role can manage jobs: by default the owner, admins, project managers and office staff. Sales reps, field crews and subcontractors don't book by default, and permissions can be adjusted seat by seat.",
    },
    {
      q: "Does it sync both ways with Google Calendar?",
      a: "No. Schedule pushes your visits to Google Calendar when you press Sync now; events you add in Google don't come back into the CRM. The company feed is read-only as well, and each calendar app refreshes it on its own timetable.",
    },
    {
      q: "Can my clients book online or get appointment reminders?",
      a: "Not today. Schedule is your team's calendar: clients don't book through it, and it doesn't text or email them about their appointments.",
    },
  ],
  related: ["crm", "crmLeads", "texting"],
  app: { href: "/crm/schedule", surface: "portal", label: "Open Schedule" },
  headings: {
    steps: { title: "From Booking to Their Phone in ", em: "Four Steps" },
    cards: { title: "What Schedule ", em: "Gives You" },
  },
  seo: {
    title: "Schedule — Crew Calendar for Contractors | ConstructHUB",
    description:
      "Book appointments and crew visits, get crew conflict warnings, filter to anyone's calendar, and push the schedule to Google Calendar or any calendar app.",
  },
  sources: [
    "client/src/pages/crm-schedule.tsx",
    "client/src/components/crm-appointment-form.tsx",
    "client/src/pages/crm-settings.tsx",
    "client/src/pages/crm-team.tsx",
    "server/crm/schedule.ts",
    "server/crm/calendar.ts",
    "server/crm/ical.ts",
    "server/crm/appointments.test.ts",
    "shared/schema.ts",
    "shared/plans.ts",
  ],
};

export default page;
