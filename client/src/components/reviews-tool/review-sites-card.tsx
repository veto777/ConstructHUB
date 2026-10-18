/**
 * Google Reviews → Settings → "Review sites" (owner, 2026-10-17: "a setting for this feature that allows all the review
 * places to be added … and it extracts the sites from the profile which is added in the settings here as a link").
 *
 * Per Google Business Profile (review_templates): the Google review link, the other review sites
 * (shared/review-links.ts, saved through PATCH /api/review-templates/:id) and which one is the primary destination.
 * "Find review sites" reads one page the owner enters (their website or a review-site page; the linked Google
 * listing's stored website is offered by default) on the server and lists the review-site links written on it.
 * They are suggestions only: the owner ticks what to add, and nothing is saved until "Save review sites".
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Notice, Section, StatusPill } from "@/components/app-ui";
import { ExternalLink, Globe, Loader2, Plus, Search, X } from "lucide-react";
import { reviewsHref } from "@/components/reviews-tool/nav";
import {
  GOOGLE_DESTINATION_LABEL, MAX_OTHER_REVIEW_LINKS, MAX_REVIEW_LINK_LABEL, REVIEW_PLATFORMS, normalizeOtherReviewLinks,
  reviewLinkLabel, type OtherReviewLink,
} from "@shared/review-links";

type Template = { id: number; name: string; googleProfileUrl: string; otherReviewLinks: unknown; primaryReviewUrl?: string | null; isDefault?: boolean };
type Listing = { id: number; name: string; reviewUrl: string; website?: string | null };
type Found = { platform: OtherReviewLink["platform"] | "google"; label?: string; url: string };

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();
const foundLabel = (f: Found) => (f.platform === "google" ? GOOGLE_DESTINATION_LABEL : reviewLinkLabel({ platform: f.platform, label: f.label }));

export function ReviewSitesCard() {
  const [, navigate] = useLocation();
  const { data: templates = [], isLoading } = useQuery<Template[]>({ queryKey: ["/api/review-templates"] });
  const { data: gbp } = useQuery<{ connected: boolean; locations: Listing[] }>({ queryKey: ["/api/review-templates/gbp-locations"] });
  const [pickedId, setPickedId] = useState<string>("");
  const template = templates.find((t) => String(t.id) === pickedId)
    ?? templates.find((t) => t.isDefault) ?? templates[0];

  return (
    <Section
      testId="card-review-sites"
      title="Review sites"
      description="Where happy clients are sent: Google plus your other review sites, for each Google Business Profile."
      actions={template ? <StatusPill tone="info" data-testid="badge-review-sites-count">{1 + normalizeOtherReviewLinks(template.otherReviewLinks).links.length} sites</StatusPill> : undefined}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading profiles…</div>
      ) : !template ? (
        <Notice tone="warning" testId="notice-review-sites-no-profile">
          Add a Google Business Profile first; its review sites are set here.{" "}
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => navigate(reviewsHref("profiles"))} data-testid="link-review-sites-add-profile">
            Go to Profiles &amp; links
          </button>
        </Notice>
      ) : (
        <div className="space-y-4">
          {templates.length > 1 && (
            <div className="space-y-2 sm:max-w-sm">
              <Label htmlFor="select-review-sites-profile">Google Business Profile</Label>
              <Select value={String(template.id)} onValueChange={setPickedId}>
                <SelectTrigger id="select-review-sites-profile" data-testid="select-review-sites-profile"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}{t.isDefault ? " (Default)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <ProfileSitesEditor key={template.id} template={template} listings={gbp?.locations ?? []} />
        </div>
      )}
    </Section>
  );
}

function ProfileSitesEditor({ template, listings }: { template: Template; listings: Listing[] }) {
  const { toast } = useToast();
  const savedLinks = useMemo(() => normalizeOtherReviewLinks(template.otherReviewLinks).links, [template.otherReviewLinks]);
  const [googleUrl, setGoogleUrl] = useState(template.googleProfileUrl);
  const [links, setLinks] = useState<OtherReviewLink[]>(savedLinks);
  const [primaryUrl, setPrimaryUrl] = useState(template.primaryReviewUrl || "");
  // Back to the saved values whenever the saved profile changes (after a save, or an edit in the profile dialog).
  useEffect(() => {
    setGoogleUrl(template.googleProfileUrl);
    setLinks(savedLinks);
    setPrimaryUrl(template.primaryReviewUrl || "");
  }, [template.googleProfileUrl, savedLinks, template.primaryReviewUrl]);

  const checked = normalizeOtherReviewLinks(links);
  const validLinks = checked.links;
  const effectivePrimary = primaryUrl && validLinks.some((l) => l.url === primaryUrl) ? primaryUrl : "";
  const dirty = googleUrl.trim() !== template.googleProfileUrl
    || JSON.stringify(validLinks) !== JSON.stringify(savedLinks)
    || links.length !== savedLinks.length
    || effectivePrimary !== (template.primaryReviewUrl || "");

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { otherReviewLinks: links, primaryReviewUrl: effectivePrimary };
      if (googleUrl.trim() !== template.googleProfileUrl) body.googleProfileUrl = googleUrl.trim();
      await apiRequest("PATCH", `/api/review-templates/${template.id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/review-templates"] });
      toast({ title: "Review sites saved", description: "Requests you send from now on use these sites." });
    },
    onError: (err: any) => toast({ title: "Couldn't save review sites", description: apiErrorMessage(err), variant: "destructive" }),
  });

  const update = (i: number, patch: Partial<OtherReviewLink>) => setLinks((rows) => rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  // Suggestions: add ticked links to the list (the owner still saves). One link per known site; a found link for a
  // site already listed replaces it; a Google link replaces the Google review link.
  const addFound = (picked: Found[]) => {
    let next = [...links];
    let nextGoogle = googleUrl;
    for (const f of picked) {
      if (f.platform === "google") { nextGoogle = f.url; continue; }
      const row: OtherReviewLink = f.platform === "other" ? { platform: "other", label: f.label || "Review site", url: f.url } : { platform: f.platform, url: f.url };
      const at = f.platform === "other" ? next.findIndex((l) => sameUrl(l.url, f.url)) : next.findIndex((l) => l.platform === f.platform);
      if (at >= 0) next[at] = row;
      else if (next.length < MAX_OTHER_REVIEW_LINKS) next.push(row);
    }
    setLinks(next);
    setGoogleUrl(nextGoogle);
  };

  const listing = listings.find((l) => l.reviewUrl === template.googleProfileUrl) ?? (listings.length === 1 ? listings[0] : undefined);

  return (
    <div className="space-y-5" data-testid={`review-sites-editor-${template.id}`}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Sites clients can review you on</Label>
          <Button type="button" variant="outline" size="sm" onClick={() => setLinks((rows) => [...rows, { platform: "yelp", url: "" }])}
            disabled={links.length >= MAX_OTHER_REVIEW_LINKS} data-testid="button-review-sites-add">
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Add a site
          </Button>
        </div>
        <div className="space-y-2 rounded-xl border p-2 sm:p-3">
          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap" data-testid="row-review-site-google">
            <div className="flex h-9 flex-1 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium sm:w-36 sm:flex-none">Google</div>
            <Input type="url" inputMode="url" className="order-last min-w-0 basis-full sm:order-none sm:basis-auto sm:flex-1" value={googleUrl} onChange={(e) => setGoogleUrl(e.target.value)}
              placeholder="https://g.page/r/..." aria-label="Google review link" data-testid="input-review-site-google" />
            <span className="hidden w-8 shrink-0 sm:block" aria-hidden="true" />
          </div>
          {links.map((link, i) => {
            const platform = REVIEW_PLATFORMS.find((p) => p.key === link.platform);
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 max-sm:border-t max-sm:pt-2 sm:flex-nowrap" data-testid={`row-review-site-${i}`}>
                <Select value={link.platform} onValueChange={(v) => update(i, { platform: v as OtherReviewLink["platform"] })}>
                  <SelectTrigger className="min-w-0 flex-1 sm:w-36 sm:flex-none" aria-label="Review site" data-testid={`select-review-site-platform-${i}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REVIEW_PLATFORMS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {link.platform === "other" && (
                  <Input className="min-w-0 flex-1 sm:w-32 sm:flex-none" value={link.label ?? ""} onChange={(e) => update(i, { label: e.target.value })} placeholder="Site name"
                    maxLength={MAX_REVIEW_LINK_LABEL} aria-label="Site name" data-testid={`input-review-site-label-${i}`} />
                )}
                <Input type="url" inputMode="url" className="order-last min-w-0 basis-full sm:order-none sm:basis-auto sm:flex-1" value={link.url} onChange={(e) => update(i, { url: e.target.value })}
                  placeholder={`https://${platform?.hint ?? ""}`} aria-label="Review page address" data-testid={`input-review-site-url-${i}`} />
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Remove this site"
                  onClick={() => setLinks((rows) => rows.filter((_, j) => j !== i))} data-testid={`button-review-site-remove-${i}`}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            );
          })}
          {links.length === 0 && (
            <p className="px-1 text-xs text-muted-foreground">No other sites yet. Add Yelp, BBB, Houzz and more, or find them on your website below.</p>
          )}
        </div>
        {checked.error && <p className="text-xs text-destructive" data-testid="text-review-sites-error">{checked.error}</p>}
      </div>

      <div className="grid gap-2 sm:grid-cols-[220px_1fr] sm:items-start">
        <div className="space-y-2">
          <Label htmlFor={`select-review-sites-primary-${template.id}`}>Send happy clients to</Label>
          <Select value={effectivePrimary || "__google__"} onValueChange={(v) => setPrimaryUrl(v === "__google__" ? "" : v)}>
            <SelectTrigger id={`select-review-sites-primary-${template.id}`} data-testid="select-review-sites-primary"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__google__">Google</SelectItem>
              {validLinks.map((l) => <SelectItem key={l.url} value={l.url}>{reviewLinkLabel(l)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground sm:pt-7">
          The primary destination is the first review step. The other sites are offered after it. You can change both on each request.
        </p>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={!dirty || !!checked.error || !googleUrl.trim() || save.isPending} data-testid="button-save-review-sites">
          {save.isPending ? "Saving…" : "Save review sites"}
        </Button>
      </div>

      <ReviewSiteFinder
        defaultLink={listing?.website ?? ""}
        googleUrl={googleUrl}
        links={links}
        onAdd={addFound}
      />
    </div>
  );
}

function ReviewSiteFinder({ defaultLink, googleUrl, links, onAdd }: {
  defaultLink: string; googleUrl: string; links: OtherReviewLink[]; onAdd: (picked: Found[]) => void;
}) {
  const { toast } = useToast();
  const [link, setLink] = useState(defaultLink);
  const [result, setResult] = useState<{ finalUrl: string; found: Found[] } | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  useEffect(() => { setLink((v) => v || defaultLink); }, [defaultLink]);

  const find = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/review-templates/find-review-sites", { url: link.trim() })).json() as Promise<{ finalUrl: string; found: Found[] }>,
    onSuccess: (data) => { setResult(data); setTicked(new Set()); },
    onError: (err: any) => { setResult(null); toast({ title: "Couldn't look for review sites", description: apiErrorMessage(err), variant: "destructive" }); },
  });

  const isListed = (f: Found) => f.platform === "google" ? sameUrl(f.url, googleUrl) : links.some((l) => sameUrl(l.url, f.url));
  const replaces = (f: Found) => {
    if (f.platform === "google") return googleUrl.trim() ? "Replaces your Google review link" : "";
    if (f.platform === "other") return "";
    const cur = links.find((l) => l.platform === f.platform && l.url.trim());
    return cur ? `Replaces your ${reviewLinkLabel(cur)} link` : "";
  };
  const toggle = (f: Found, on: boolean) => setTicked((s) => {
    const next = new Set(s);
    if (on) {
      // One per known site (and one Google link): ticking another for the same site swaps the tick.
      if (f.platform !== "other") for (const other of result?.found ?? []) if (other.platform === f.platform && other.url !== f.url) next.delete(other.url);
      next.add(f.url);
    } else next.delete(f.url);
    return next;
  });
  const room = MAX_OTHER_REVIEW_LINKS - links.length;

  return (
    <div className="space-y-3 rounded-xl border border-dashed p-3 sm:p-4" data-testid="section-find-review-sites">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-semibold"><Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Find review sites</div>
        <p className="text-xs text-muted-foreground">
          Enter your website (or one of your review pages). We read that page and list the review-site links on it. Nothing is added until you tick it.
        </p>
      </div>
      <form noValidate className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (link.trim()) find.mutate(); }}>
        <Label htmlFor="input-find-review-sites" className="sr-only">Website or review page</Label>
        <div className="relative min-w-0 flex-1">
          <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="input-find-review-sites" type="url" inputMode="url" className="pl-9" value={link} onChange={(e) => setLink(e.target.value)}
            placeholder="https://yourcompany.com" data-testid="input-find-review-sites" />
        </div>
        <Button type="submit" variant="outline" disabled={!link.trim() || find.isPending} data-testid="button-find-review-sites">
          {find.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Looking…</> : "Find review sites"}
        </Button>
      </form>
      {defaultLink && link === defaultLink && !result && (
        <p className="text-xs text-muted-foreground" data-testid="text-find-default-link">This is the website saved on your linked Google listing.</p>
      )}
      {result && (
        result.found.length === 0 ? (
          <Notice tone="info" testId="notice-find-none">
            No review-site links on that page. Try your Contact or Reviews page, or paste each site&rsquo;s review page above.
          </Notice>
        ) : (
          <div className="space-y-2" data-testid="list-found-review-sites">
            <p className="text-xs text-muted-foreground">Found on <span className="break-all font-medium text-foreground">{result.finalUrl}</span>. Tick the ones to add:</p>
            <ul className="space-y-1 rounded-lg border bg-background p-1">
              {result.found.map((f, i) => {
                const listed = isListed(f);
                const note = listed ? "Already added" : replaces(f);
                return (
                  <li key={f.url}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60 has-[:disabled]:cursor-default has-[:disabled]:opacity-60">
                      <input type="checkbox" className="mt-1" checked={listed || ticked.has(f.url)} disabled={listed}
                        onChange={(e) => toggle(f, e.target.checked)} data-testid={`checkbox-found-site-${i}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{foundLabel(f)}{note && <span className="ml-2 text-xs font-normal text-muted-foreground">· {note}</span>}</span>
                        <span className="block truncate text-xs text-muted-foreground">{f.url}</span>
                      </span>
                      <a href={f.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground" title="Open this page" onClick={(e) => e.stopPropagation()}>
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">Check each one is the page where a client writes a review (a profile link may need its Reviews tab).</p>
            <div className="flex justify-end">
              <Button type="button" size="sm" disabled={ticked.size === 0}
                onClick={() => {
                  const picked = (result.found).filter((f) => ticked.has(f.url));
                  const others = picked.filter((f) => f.platform !== "google" && !links.some((l) => l.platform === f.platform && f.platform !== "other"));
                  if (others.length > room) toast({ title: `Up to ${MAX_OTHER_REVIEW_LINKS} other review sites`, description: "Only the first ones fit; remove a site to add more.", variant: "destructive" });
                  onAdd(picked);
                  setTicked(new Set());
                  toast({ title: "Added to the list", description: "Check the addresses, then Save review sites." });
                }}
                data-testid="button-add-found-sites">
                Add {ticked.size || ""} to the list
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
