import { ScanIndexingSummary } from "./site-connections";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useUrlParam } from "@/hooks/use-url-param";
const api = async (method: string, url: string, body?: unknown) =>
  (await apiRequest(method, url, body)).json();
function canonicalUrl(value: string) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return value;
  }
}
const severityOrder: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};
function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => setCopied(true))
      }
    >
      {copied ? "Copied" : "Copy draft"}
    </Button>
  );
}
export function ScanReport({ report, draft, summary = false }: { report: any; draft?: string; summary?: boolean }) {
  if (!report) return null;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {Object.entries({
          overall: report.scores.overall,
          ...report.scores.categories,
        }).map(([name, value]) => (
          <Card key={name}>
            <CardContent className="pt-5">
              <p className="capitalize text-sm text-muted-foreground">
                {name.replace("-", " ")}
              </p>
              <p className="text-3xl font-semibold">
                {value === null ? "N/A" : String(value)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {report.pages} pages checked. {summary
          ? "Preview shows up to five findings. Verify your email for all findings and coverage details."
          : `${report.remaining || 0} URLs remain outside this report.`} Scores describe observed checks, not search rankings.
      </p>
      {["technical", "performance", "local", "content", "ai-readiness"].map(
        (category) => (
          <section key={category}>
            <h2 className="text-xl font-semibold capitalize mb-3">
              {category.replace("-", " ")}
            </h2>
            <div className="space-y-3">
              {report.findings
                .filter((f: any) => f.category === category)
                .sort(
                  (a: any, b: any) =>
                    severityOrder[a.severity] - severityOrder[b.severity],
                )
                .map((f: any) => (
                  <Card key={f.id}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">
                        <span
                          className={
                            f.severity === "critical"
                              ? "text-red-600"
                              : "text-amber-600"
                          }
                        >
                          {f.severity.toUpperCase()}
                        </span>{" "}
                        · {f.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-2">
                      <p>{f.why}</p>
                      <p>
                        <strong>How to fix:</strong> {f.fix}
                      </p>
                      <details>
                        <summary>Affected URLs ({f.urls.length})</summary>
                        <ul className="break-all">
                          {f.urls.map((url: string) => (
                            <li key={url}>{url}</li>
                          ))}
                        </ul>
                      </details>
                    </CardContent>
                  </Card>
                ))}
              {!report.findings.some((f: any) => f.category === category) && (
                <p className="text-sm text-muted-foreground">
                  {summary ? "Verify your email to see all findings in this category." : "No findings from available checks."}
                </p>
              )}
            </div>
          </section>
        ),
      )}
      {!summary && <p className="text-sm text-muted-foreground">
        {report.profile
          ? `GBP comparison: ${report.profile.business_name}; profile last synced ${new Date(report.profile.synced_at).toLocaleString()}.`
          : "No synced GBP profile: NAP, service and service-area comparisons were not assessed."}
      </p>}
      {report.psi?.length > 0 && (
        <details>
          <summary>PageSpeed measurements and field data</summary>
          <pre className="text-xs whitespace-pre-wrap break-all">
            {JSON.stringify(report.psi, null, 2)}
          </pre>
        </details>
      )}
      {report.jsonLdDraft && (
        <Card>
          <CardHeader>
            <CardTitle>GBP JSON-LD draft</CardTitle>
            <p>
              Review for accuracy before publishing. Unknown values are omitted.
            </p>
          </CardHeader>
          <CardContent>
            <Copy text={JSON.stringify(report.jsonLdDraft, null, 2)} />
            <pre className="whitespace-pre-wrap break-all text-xs mt-3">
              {JSON.stringify(report.jsonLdDraft, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
      {draft && (
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              AI fix plan — draft
            </CardTitle>
            <p>
              Review every claim before publishing. This has not been applied to
              your website.
            </p>
          </CardHeader>
          <CardContent>
            <Copy text={draft} />
            <pre className="whitespace-pre-wrap break-all font-sans text-sm mt-3">
              {draft}
            </pre>
          </CardContent>
        </Card>
      )}
      <p className="text-sm text-muted-foreground">
        {report.coverage?.notes?.join(" ")}
      </p>
    </div>
  );
}
export default function SiteScanPage() {
  const cache = useQueryClient();
  const [scanParam, setScanParam] = useUrlParam("scan");
  const selected = scanParam ?? "", setSelected = (v: string | number) => setScanParam(v === "" ? null : String(v), true);
  const [url, setUrl] = useState(""),
    [locationId, setLocationId] = useState(""),
    [cap, setCap] = useState(150),
    [psi, setPsi] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [share, setShare] = useState("");
  const { data } = useQuery<any>({
    queryKey: ["/api/sitescan"],
    refetchInterval: (q) =>
      q.state.data?.jobs?.some((j: any) =>
        ["queued", "running"].includes(j.status),
      )
        ? 3000
        : false,
  });
  const { data: job } = useQuery<any>({
    queryKey: ["/api/sitescan/jobs/" + selected],
    enabled: !!selected,
    refetchInterval: (q) =>
      ["completed", "failed"].includes(q.state.data?.status) ? false : 3000,
  });
  useEffect(() => {
    if (!url && data?.locations?.[0]?.website) {
      setUrl(data.locations[0].website);
      setLocationId(String(data.locations[0].id));
    }
  }, [data]);
  const action = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
      await cache.invalidateQueries({ queryKey: ["/api/sitescan"] });
      if (selected)
        await cache.invalidateQueries({
          queryKey: ["/api/sitescan/jobs/" + selected],
        });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Site Scan</h1>
        <p className="text-muted-foreground mt-2">
          Find website issues, compare your Google Business Profile, and draft
          your next fixes.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <label className="block">
            Linked GBP location
            <select
              className="block border rounded p-2 w-full bg-background"
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
                const l = data?.locations.find(
                  (l: any) => String(l.id) === e.target.value,
                );
                if (l?.website) setUrl(l.website);
              }}
            >
              <option value="">No GBP comparison</option>
              {data?.locations.map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.business_name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Website URL
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-website.com"
            />
          </label>
          <div className="flex flex-wrap gap-4">
            <label>
              Page cap
              <Input
                type="number"
                min={1}
                max={500}
                value={cap}
                onChange={(e) => setCap(Number(e.target.value))}
              />
            </label>
            <label>
              PageSpeed pages (mobile + desktop)
              <Input
                type="number"
                min={0}
                max={5}
                value={psi}
                onChange={(e) => setPsi(Number(e.target.value))}
              />
            </label>
          </div>
          <Button
            disabled={busy || !url}
            onClick={() =>
              action(async () => {
                const r = await api("POST", "/api/sitescan", {
                  url,
                  locationId: locationId ? Number(locationId) : undefined,
                  pageCap: cap,
                  psiPages: psi,
                });
                setSelected(r.id);
                setShare("");
              })
            }
          >
            Start scan
          </Button>
          <Button
            variant="outline"
            className="ml-3"
            disabled={busy || !url}
            onClick={() =>
              action(async () => {
                await api("POST", "/api/sitescan/schedule", {
                  url,
                  locationId: locationId ? Number(locationId) : undefined,
                  pageCap: cap,
                  psiPages: psi,
                  enabled: !data?.schedules.some(
                    (s: any) => s.url === canonicalUrl(url),
                  ),
                });
              })
            }
          >
            {data?.schedules.some((s: any) => s.url === canonicalUrl(url))
              ? "Disable monthly rescan"
              : "Enable monthly rescan"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Up to 5 scans/day, 20 PageSpeed requests/day and 3 AI drafts/day (20
            AI page-batch calls). Larger scans can take several minutes.
          </p>
        </CardContent>
      </Card>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <section>
        <h2 className="text-xl font-semibold mb-2">History & score trend</h2>
        <div className="flex flex-wrap gap-2">
          {data?.jobs.map((j: any, index: number) => (
            <Button
              variant={selected === j.id ? "default" : "outline"}
              className="h-auto max-w-full whitespace-normal break-all text-left"
              key={j.id}
              onClick={() => {
                setSelected(j.id);
                setShare("");
              }}
            >
              {new Date(j.created_at).toLocaleDateString()} · {j.url} ·{" "}
              {j.scores?.overall ?? j.status}
              {(() => {
                const old = data.jobs
                  .slice(index + 1)
                  .find(
                    (p: any) =>
                      p.url === j.url && typeof p.scores?.overall === "number",
                  );
                const delta =
                  old && typeof j.scores?.overall === "number"
                    ? j.scores.overall - old.scores.overall
                    : null;
                return delta === null
                  ? ""
                  : ` (${delta > 0 ? "+" : ""}${delta} since prior scan)`;
              })()}
            </Button>
          ))}
          {data?.jobs.length === 0 && <p>No scans yet.</p>}
        </div>
      </section>
      {job && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold break-all">{job.url}</h2>
          <p role="status">
            {job.status} · {job.pages}/{job.pageCap} pages checked
          </p>
          {job.error && <p role="alert">{job.error}</p>}
          {job.report && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api("POST", `/api/sitescan/jobs/${selected}/plan`);
                    })
                  }
                >
                  {busy ? "Working…" : "Generate AI fix plan"}
                </Button>
                <a
                  className="border rounded px-4 py-2 text-sm"
                  href={`/api/sitescan/jobs/${selected}/pdf`}
                >
                  Export PDF
                </a>
                <Button
                  variant="outline"
                  onClick={() =>
                    action(async () => {
                      const r = await api(
                        "POST",
                        `/api/sitescan/jobs/${selected}/share`,
                      );
                      setShare(window.location.origin + r.path);
                    })
                  }
                >
                  Create share link
                </Button>
                {job.shareEnabled && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      action(async () => {
                        await api(
                          "DELETE",
                          `/api/sitescan/jobs/${selected}/share`,
                        );
                        setShare("");
                      })
                    }
                  >
                    Revoke share link
                  </Button>
                )}
              </div>
              {share && (
                <p className="break-all">
                  Read-only link (30 days):{" "}
                  <a href={share} className="underline">
                    {share}
                  </a>
                </p>
              )}
              <ScanReport report={job.report} draft={job.aiDraft} />
              <ScanIndexingSummary scanId={job.id} />
            </>
          )}
        </section>
      )}
    </main>
  );
}
export function SharedSiteScanPage() {
  const token = window.location.pathname.split("/").pop();
  const { data, error } = useQuery<any>({
    queryKey: ["/api/sitescan/shared/" + token],
    retry: false,
  });
  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Shared Site Scan</h1>
      {error && <p role="alert">This report link is unavailable or revoked.</p>}
      <ScanReport report={data?.report} draft={data?.aiDraft} />
    </main>
  );
}
export function FreeSiteScanPage() {
  const [url, setUrl] = useState(""),
    [email, setEmail] = useState(""),
    [access, setAccess] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [captchaToken, setCaptcha] = useState("");
  const captchaWidget = useRef<number | null>(null);
  const verify = new URLSearchParams(window.location.search).get("verify");
  const { data: config } = useQuery<any>({
    queryKey: ["/api/sitescan/public/config"],
  });
  useEffect(() => {
    if (!config?.captchaSiteKey) return;
    let stopped = false;
    const render = () => {
      const g = (window as any).grecaptcha;
      if (!stopped && g?.render)
        g.ready(() => {
          if (!stopped)
            captchaWidget.current = g.render("sitescan-captcha", {
              sitekey: config.captchaSiteKey,
              callback: setCaptcha,
              "expired-callback": () => setCaptcha(""),
              "error-callback": () => setCaptcha(""),
            });
        });
    };
    const script = document.createElement("script");
    script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
    script.onload = render;
    document.head.appendChild(script);
    return () => {
      stopped = true;
      script.remove();
    };
  }, [config?.captchaSiteKey]);
  const { data, error: reportError } = useQuery<any>({
    queryKey: ["sitescan-public", access, verify],
    enabled: !!access || !!verify,
    queryFn: () =>
      verify
        ? api("POST", "/api/sitescan/public/verify", { token: verify })
        : api("GET", "/api/sitescan/public/status/" + access),
    refetchInterval: (q) =>
      q.state.error || ["completed", "failed"].includes(q.state.data?.status)
        ? false
        : 3000,
    retry: false,
  });
  return (
    <main className="max-w-4xl mx-auto p-8 space-y-6">
      <a href="/" className="text-primary">
        ConstructHUB
      </a>
      <h1 className="text-4xl font-bold">Free 60-second website scan</h1>
      <p>
        Discover the first fixes for your contractor website. We check up to 11
        pages; slow sites can take longer. Verify your email to unlock the
        complete quick-scan report.
      </p>
      {!verify && !access && (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await api("POST", "/api/sitescan/public/start", {
                url,
                email,
                captchaToken,
              });
              setAccess(r.access);
            } catch (e: any) {
              setError(e.message);
              // Tokens are single-use, including when a later server step fails.
              if (captchaWidget.current !== null) {
                (window as any).grecaptcha?.reset(captchaWidget.current);
                setCaptcha("");
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block">
            Website URL
            <Input
              required
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="block">
            Email
            <Input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <div id="sitescan-captcha" />
          <Button disabled={busy || !config || (!!config.captchaSiteKey && !captchaToken)}>Scan my website</Button>
          <p className="text-xs">
            We use your email to deliver this report.{" "}
            <a href="/privacy" className="underline">
              Privacy policy
            </a>
          </p>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {reportError && (
        <p role="alert">
          The scan could not be loaded. The link may have expired or the request
          limit was reached.
        </p>
      )}
      {access && (
        <p>
          Check your email for the verification link to unlock the full report.
        </p>
      )}
      {data && (
        <p role="status">
          Scan {data.status}. {data.error}
        </p>
      )}
      {data?.summary && <ScanReport report={data.summary} summary />}
      <ScanReport report={data?.report} />
    </main>
  );
}
export function SiteScanLeads() {
  const { data, error } = useQuery<any>({
    queryKey: ["/api/admin/sitescan-leads"],
    retry: false,
  });
  return (
    <section className="p-6">
      <h2 className="text-xl font-semibold">Site Scan leads</h2>
      {error && <p>Platform admin access required.</p>}
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th>Email</th>
            <th>Website</th>
            <th>Verified</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data?.leads.map((l: any) => (
            <tr key={l.id}>
              <td>{l.email}</td>
              <td>{l.url}</td>
              <td>{l.verified_at ? "Yes" : "No"}</td>
              <td>{l.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
