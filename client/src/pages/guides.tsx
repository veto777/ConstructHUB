import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
const guides = [
  {
    title: "Connect Blotato",
    steps: [
      "Visit Blotato and create your own account. Blotato is a separate subscription you buy from Blotato; creating an API key activates its paid subscription.",
      "Connect your social accounts inside Blotato. For Facebook, grant access to the Pages you manage.",
      "In Blotato Settings, open API and create/copy an API key. Never send the key to anyone else.",
      "Open Social Media in ConstructHUB, paste the key into Blotato API key, and choose Connect Blotato. Your connected platforms appear.",
      "In Compose, select accounts. Use Refresh pages or boards, then select the destination. Disconnect stops local queued posts and auto mode; manage already-submitted posts and billing in Blotato.",
    ],
  },
  {
    title: "Manual posting",
    steps: [
      "Open Social Media → Compose. Select accounts/pages and enter Post text.",
      "Use each platform’s text tweak and character counter. Add public media URLs, attach a Media Library photo, or Upload through Blotato.",
      "For YouTube, supply a title, video and privacy choice. TikTok defaults to private; choose public explicitly and set any business/paid partnership disclosures.",
      "Choose Post now, or enter Schedule time in your browser’s local timezone and choose Schedule post. Save draft keeps the post for approval.",
      "Open Calendar & queue. Each destination has its own status. Approve & queue a draft, or cancel before submission. Follow View published post or Open Blotato status.",
      "If status is uncertain, check the submission in Blotato before creating another post. A queued or accepted submission is not a confirmed publication.",
    ],
  },
  {
    title: "Auto mode",
    steps: [
      "Add your business details in Locations. Add public project photos to Media Library and sync Google reviews if you want those content sources.",
      "In Social Media → Compose, select the accounts/pages to use. Open Auto mode and choose Use accounts selected in Compose.",
      "Choose cadence, content mix, timezone, blackout hours, business instructions, writing examples, and daily AI budget. Add factual offers under Content sources. Use Sync recent GBP updates to import live standard updates from linked Google locations; auto mode refreshes them before cross-posting.",
      "Start with Approval queue, enable auto mode and Save auto settings. Generate draft from saved settings lets you preview without publishing.",
      "Review AI-generated drafts in Calendar & queue; edit the text and choose Approve & queue.",
      "Only choose Fully automatic if you authorize generated posts to publish without review. Disabling auto mode returns pending automatic posts to drafts. Missing source material is reported instead of invented. Remove expired offers promptly.",
    ],
  },
  {
    title: "Profile Guard",
    steps: [
      "Open the business location’s Profile Guard controls. Choose Off to stop protection, Notify for alerts, or Lockdown to restore protected changes.",
      "Review the detected change and compare it with the approved profile. Choose approve or reject after checking accuracy.",
      "Use reporting to review detected changes, actions, and failures. Lockdown can require renewed Google access; check any failure notices.",
    ],
  },
  {
    title: "AI review replies",
    steps: [
      "Open Google Reviews and sync the connected business’s reviews.",
      "Generate an AI reply draft, check the facts, tone and any private information, then edit it.",
      "Publish the reply explicitly, or keep it as a draft. Enable automatic replies only if you want that setting to authorize publication.",
      "Check the posted status and notification; a saved draft has not been sent to Google.",
    ],
  },
  {
    title: "Posts & Photos scheduling and AI captions",
    steps: [
      "Open Posts & Photos for the business location. Choose a real photo or write a business update.",
      "Generate an AI caption if useful, then check and edit the draft.",
      "Choose the date and time and confirm the schedule or publish action.",
      "Review the queue and publication status. Resolve failed media or connection errors before retrying.",
    ],
  },
  {
    title: "Security",
    steps: [
      "Open Settings → Security. Turn on 2FA, complete verification, and store recovery codes privately.",
      "Use remember device only on a private device you control. Remove remembered devices you no longer use.",
      "Complete re-authentication when prompted before changing sensitive account settings.",
      "Open Notifications to set delivery preferences. Security notices may always be emailed.",
      "Review the activity log for account connections, security changes, time, IP and device information. Investigate unfamiliar activity and disconnect access you do not recognize.",
    ],
  },
];
export default function GuidesPage() {
  return (
    <div className="h-full overflow-y-auto">
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <h1 className="text-3xl font-bold">Guides</h1>
        <p className="text-muted-foreground">
          Step-by-step help for your business tools. Profile Guard, AI review
          replies, Posts & Photos, and Security labels may vary as these
          features roll out.
        </p>
        <a className="underline text-primary" href="/social-media">
          Open Social Media
        </a>
        {guides.map((g) => (
          <Card key={g.title}>
            <CardHeader>
              <CardTitle>{g.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal pl-5 space-y-3">
                {g.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
