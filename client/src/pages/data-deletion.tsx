import { useEffect, useState } from "react";
import { copyrightNotice } from "@/lib/marketing";
import { LegalPage } from "@/components/legal-page";
import { HelpButton } from "@/components/help-button";

/**
 * /data-deletion — public, no sign-in. How to delete what ConstructHUB holds from connected social accounts, and
 * the status of a deletion request a network (Meta) asked us to carry out: /data-deletion?code=<confirmation code>
 * (server/social/deletion.ts). Linked from the footers next to Terms and Privacy.
 */
type Status = { status: "completed" | "received"; completedAt: string | null };

const NETWORKS = "Facebook, Instagram, Threads, TikTok, LinkedIn, YouTube, Pinterest, X and Bluesky";

export default function DataDeletionPage() {
  const code = typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("code") ?? "").trim().toUpperCase();
  const [status, setStatus] = useState<Status | null>(null);
  const [lookup, setLookup] = useState<"idle" | "loading" | "missing" | "error">(code ? "loading" : "idle");

  useEffect(() => {
    document.title = "Data Deletion | ConstructHUB";
  }, []);
  useEffect(() => {
    if (!code) return;
    if (!/^[A-Z0-9]{6,20}$/.test(code)) { setLookup("missing"); return; }
    fetch(`/api/social/native/data-deletion/status?code=${encodeURIComponent(code)}`)
      .then(async (r) => {
        if (r.status === 404) return setLookup("missing");
        if (!r.ok) return setLookup("error");
        setStatus(await r.json()); setLookup("idle");
      })
      .catch(() => setLookup("error"));
  }, [code]);

  return (
    <LegalPage
      path="/data-deletion"
      pageTestId="page-data-deletion"
      title="Data Deletion"
      titleTestId="heading-data-deletion"
      date="Last updated: October 12, 2026"
      dateTestId="text-data-deletion-date"
      footer={copyrightNotice()}
    >
      {/* The "i" (owner 2026-10-15): LegalPage draws the title, so it sits on the first line of the text. */}
      <p className="mb-4 flex items-center gap-1 text-sm" data-testid="text-data-deletion-help">
        <span>What this page is for and how to use it</span>
        <HelpButton k="data-deletion" />
      </p>
      {code && (
        <section className="mb-8 rounded-lg border p-4" data-testid="section-deletion-status">
          <h2 className="text-lg font-semibold mb-2">Deletion request {code}</h2>
          {lookup === "loading" && <p>Checking…</p>}
          {lookup === "missing" && <p data-testid="text-deletion-missing">We can't find a deletion request with that code. Check the code, or email <a href="mailto:support@constructhub.us" className="text-primary hover:underline">support@constructhub.us</a>.</p>}
          {lookup === "error" && <p>We couldn't check that right now. Please try again in a few minutes.</p>}
          {status && (
            <p data-testid="text-deletion-status">
              {status.status === "completed"
                ? <>Completed{status.completedAt ? ` on ${new Date(status.completedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}` : ""}. We deleted the connected accounts, their access tokens and the related records we held. Posts already published on the network belong to you and stay there until you delete them on that network.</>
                : <>Received. We are deleting the data and this page will show "Completed" when it is done.</>}
            </p>
          )}
        </section>
      )}

      <p className="mb-6" data-testid="text-intro">
        When you connect social media accounts to ConstructHUB ({NETWORKS}), we keep only what we need to publish the posts
        you choose and to show you how they are doing. You can have all of it deleted at any time, in any of these ways:
      </p>

      <section className="mb-8" data-testid="section-disconnect">
        <h2 className="text-xl font-semibold mb-3">1. Disconnect in ConstructHUB (immediate)</h2>
        <p>
          Open <strong>Social Media → Connected accounts</strong> and choose <strong>Disconnect</strong>. We delete the
          stored sign-ins (access tokens) and the connected account details at once, and posts waiting in your queue are
          cancelled.
        </p>
      </section>

      <section className="mb-8" data-testid="section-delete-account">
        <h2 className="text-xl font-semibold mb-3">2. Delete your ConstructHUB account</h2>
        <p>
          In <strong>Settings → My account</strong>, deleting your account deletes everything we hold for it, including
          every connected social account, its tokens, your scheduled and published post records, and the statistics and
          comments we showed you.
        </p>
      </section>

      <section className="mb-8" data-testid="section-network-settings">
        <h2 className="text-xl font-semibold mb-3">3. Remove ConstructHUB in the network's own settings</h2>
        <p className="mb-2">
          You can remove ConstructHUB's access from the network itself. Networks with deletion notifications tell us to delete the same data automatically. For example:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Facebook</strong>: Settings &amp; privacy → Settings → Business integrations (or Apps and websites) → ConstructHUB → Remove.</li>
          <li><strong>Instagram</strong>: Settings → Website permissions → Apps and websites → ConstructHUB → Remove.</li>
          <li><strong>Threads</strong>: Settings → Account → Website permissions → ConstructHUB → Remove.</li>
          <li><strong>TikTok, LinkedIn, YouTube (Google), Pinterest and Bluesky</strong>: remove ConstructHUB under the connected or authorized apps section of that account's settings.</li>
        </ul>
        <p className="mt-2" data-testid="x-data-deletion">
          For X, revoke ConstructHUB at <a href="https://x.com/settings/connected_apps" className="text-primary hover:underline">X connected apps</a>. This stops access; also disconnect in ConstructHUB to delete stored access and refresh tokens and account details. Delete your ConstructHUB account or request deletion by email to remove retained post records. Published main posts and link replies remain on X until you delete them there.
        </p>
        <p className="mt-2">
          When Meta asks us to delete data, we give you a confirmation code. You can check its status on this page at
          <code className="mx-1">constructhub.us/data-deletion?code=YOURCODE</code>.
        </p>
      </section>

      <section className="mb-8" data-testid="section-email">
        <h2 className="text-xl font-semibold mb-3">4. Ask us by email</h2>
        <p>
          Email{" "}
          <a href="mailto:support@constructhub.us" className="text-primary hover:underline" data-testid="link-deletion-email">support@constructhub.us</a>{" "}
          from the address on your ConstructHUB account and tell us which connected accounts to delete. We will delete the
          data within 30 days and confirm by email. YouTube data is deleted sooner: at once when you disconnect the channel,
          and in any case within 7 days of your request.
        </p>
      </section>

      <section className="mb-8" data-testid="section-what-stays">
        <h2 className="text-xl font-semibold mb-3">What is not deleted</h2>
        <p>
          Posts already published on a social network belong to you and stay there until you delete them on that network.
          Deleting data in ConstructHUB does not delete your social media accounts. See our{" "}
          <a href="/privacy" className="text-primary hover:underline" data-testid="link-deletion-privacy">Privacy Policy</a>{" "}
          for everything we collect and how long we keep it.
        </p>
      </section>
    </LegalPage>
  );
}
