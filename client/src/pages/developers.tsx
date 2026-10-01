/**
 * /developers — the public API reference, rendered from GET /api/v1/openapi.json
 * (assembled on the server from each resource's OpenAPI fragment). The parts
 * that never change — how to authenticate, the limits, what the API will not
 * do — are written here so the page is useful even before the reference is
 * published, and it says so honestly when the document isn't there.
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiErrorMessage } from "@/lib/queryClient";
import { PLANS, PLAN_KEYS } from "@shared/plans";
import { KeyRound, ShieldAlert } from "lucide-react";
import { API_NO_AI_NOTICE } from "@/pages/settings/api/api-keys-panel";

// ── The slice of OpenAPI 3 this page reads ──────────────────────────────────
type Schema = {
  type?: string; format?: string; description?: string; enum?: unknown[]; items?: Schema;
  properties?: Record<string, Schema>; required?: string[]; nullable?: boolean; $ref?: string; example?: unknown;
};
type Parameter = { name: string; in: "query" | "path" | "header" | "cookie" | string; required?: boolean; description?: string; schema?: Schema };
type Operation = {
  summary?: string; description?: string; tags?: string[]; operationId?: string; deprecated?: boolean;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; description?: string; content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, { description?: string }>;
  "x-units"?: number | string; "x-scope"?: string;
};
type OpenApiDoc = {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: { url: string; description?: string }[];
  tags?: { name: string; description?: string }[];
  paths?: Record<string, Record<string, Operation | unknown>>;
  components?: { schemas?: Record<string, Schema>; securitySchemes?: Record<string, { type?: string; scheme?: string; description?: string }> };
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
type Method = (typeof METHODS)[number];
const METHOD_CLASS: Record<Method, string> = {
  get: "bg-emerald-600 text-white", post: "bg-blue-600 text-white", put: "bg-amber-600 text-white", patch: "bg-amber-600 text-white", delete: "bg-red-600 text-white",
};

type Endpoint = { method: Method; path: string; op: Operation; tag: string };

function flatten(doc: OpenApiDoc | undefined): Endpoint[] {
  const out: Endpoint[] = [];
  for (const [path, item] of Object.entries(doc?.paths ?? {})) {
    for (const method of METHODS) {
      const op = (item as Record<string, Operation | undefined>)[method];
      if (!op || typeof op !== "object") continue;
      out.push({ method, path, op, tag: op.tags?.[0] ?? "Other" });
    }
  }
  return out;
}

/** "integer", "array of string", "object", or the referenced schema's name. */
function schemaType(s: Schema | undefined, doc: OpenApiDoc | undefined): string {
  if (!s) return "";
  if (s.$ref) {
    const name = s.$ref.split("/").pop() ?? "object";
    return name;
  }
  if (s.type === "array") return `array of ${schemaType(s.items, doc) || "object"}`;
  if (s.enum) return s.enum.map(String).join(" | ");
  return `${s.type ?? "object"}${s.format ? ` (${s.format})` : ""}${s.nullable ? ", nullable" : ""}`;
}

function resolve(s: Schema | undefined, doc: OpenApiDoc | undefined): Schema | undefined {
  if (!s?.$ref) return s;
  const name = s.$ref.split("/").pop() ?? "";
  return doc?.components?.schemas?.[name];
}

/** Monthly API units per plan, when the price book carries them (lane 1 adds apiUnitsPerMonth). */
function planUnits(): { key: string; name: string; units: number }[] | null {
  const rows = PLAN_KEYS.map((k) => {
    const units = (PLANS[k].limits as Partial<Record<"apiUnitsPerMonth", number>>).apiUnitsPerMonth;
    return typeof units === "number" ? { key: k, name: PLANS[k].name, units } : null;
  });
  return rows.every((r) => r !== null) ? (rows as { key: string; name: string; units: number }[]) : null;
}

export default function DevelopersPage() {
  const { data: doc, isLoading, error } = useQuery<OpenApiDoc>({ queryKey: ["/api/v1/openapi.json"] });
  const endpoints = useMemo(() => flatten(doc), [doc]);
  const tags = useMemo(() => {
    const order = (doc?.tags ?? []).map((t) => t.name);
    const seen = Array.from(new Set(endpoints.map((e) => e.tag)));
    return [...order.filter((t) => seen.includes(t)), ...seen.filter((t) => !order.includes(t))];
  }, [doc, endpoints]);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://constructhub.us";
  const base = `${origin}/api/v1`;
  const units = planUnits();

  useEffect(() => { document.title = "Developers | ConstructHUB"; }, []);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-developers-title">{doc?.info?.title || "ConstructHUB API"}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {doc?.info?.description || "Read your ConstructHUB data and update your records from your own tools."}
              {doc?.info?.version ? ` Version ${doc.info.version}.` : ""}
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/settings/api" data-testid="link-developers-keys"><KeyRound className="h-4 w-4 mr-1.5" aria-hidden="true" />Manage API keys</Link>
          </Button>
        </div>

        <Alert data-testid="banner-developers-no-ai">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>What the API doesn't do</AlertTitle>
          <AlertDescription>
            <span data-testid="text-developers-no-ai">{API_NO_AI_NOTICE}</span>{" "}
            Posts, review replies and social posts you create through the API are stored exactly as you send them (source: api) and
            no AI rewrites them. AI settings can't be read or changed through the API. Use your own scripts or your own AI to write
            content, then send it here on your own schedule.
          </AlertDescription>
        </Alert>

        <Card data-testid="card-developers-auth">
          <CardHeader>
            <CardTitle className="text-lg">Authentication</CardTitle>
            <CardDescription>Every request carries an API key from Settings → API keys as a bearer token. A key reads and writes only the account it belongs to.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="grid grid-cols-1 sm:grid-cols-[9rem_1fr] gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">Base URL</dt>
              <dd><code className="break-all" data-testid="text-developers-base-url">{base}</code></dd>
              <dt className="text-muted-foreground">Header</dt>
              <dd><code className="break-all">Authorization: Bearer chub_&lt;prefix&gt;_&lt;secret&gt;</code></dd>
              <dt className="text-muted-foreground">Scopes</dt>
              <dd><Badge variant="secondary" className="mr-1">read</Badge> lists and exports · <Badge variant="secondary" className="mr-1">write</Badge> creates and updates records</dd>
            </dl>
            <pre className="rounded-lg bg-muted p-3 text-xs overflow-x-auto" data-testid="text-developers-curl">
{`curl ${base}/openapi.json \\
  -H "Authorization: Bearer chub_abc123_YOUR_SECRET"`}
            </pre>
            <p className="text-xs text-muted-foreground">
              An API key never signs in to the app itself; it works only under <code>/api/v1</code>. Revoke a key the moment it may have leaked.
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-developers-limits">
          <CardHeader>
            <CardTitle className="text-lg">Limits and units</CardTitle>
            <CardDescription>Fair, predictable and the same for everyone on a plan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Rate limit:</strong> 60 requests per minute per key. Over it, <code>429</code> with a <code>Retry-After</code> header.</li>
              <li><strong>Units:</strong> a read costs 1 unit plus 1 per 100 rows returned; a write costs 5 units.</li>
              <li><strong>Monthly quota:</strong> your plan's units, and optionally a lower cap per key. When it's used up: <code>429 quota_exceeded</code>. A plan without API access: <code>402 plan_required</code>.</li>
              <li><strong>Headers on every response:</strong> <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>, <code>X-Units-Remaining</code>.</li>
            </ul>
            {units ? (
              <table className="w-full text-sm" data-testid="table-developers-plan-units">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">Plan</th><th className="py-1 font-medium text-right">Units / month</th></tr></thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.key} className="border-t" data-testid={`row-plan-units-${u.key}`}>
                      <td className="py-1">{u.name}</td>
                      <td className="py-1 text-right tabular-nums">{u.units > 0 ? u.units.toLocaleString("en-US") : "No API access"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="text-developers-plan-units">Your plan's monthly units are shown in Settings → API keys.</p>
            )}
          </CardContent>
        </Card>

        <section className="space-y-4" data-testid="section-developers-endpoints">
          <div>
            <h2 className="text-xl font-semibold">Endpoints</h2>
            <p className="text-sm text-muted-foreground">
              Generated from <a href="/api/v1/openapi.json" className="underline underline-offset-4" data-testid="link-developers-openapi">/api/v1/openapi.json</a>, which is also what an API client or your own AI can read.
            </p>
          </div>
          {isLoading ? (
            <div className="space-y-3" aria-busy="true"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
          ) : error ? (
            <Card><CardContent className="pt-6 text-sm text-muted-foreground" data-testid="text-developers-unpublished">
              The API reference isn't published on this server yet ({apiErrorMessage(error, "no response")}). The authentication, limits and AI rules above still apply.
            </CardContent></Card>
          ) : endpoints.length === 0 ? (
            <Card><CardContent className="pt-6 text-sm text-muted-foreground" data-testid="text-developers-unpublished">The API reference lists no endpoints yet.</CardContent></Card>
          ) : (
            tags.map((tag) => (
              <Card key={tag} data-testid={`card-developers-tag-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                <CardHeader>
                  <CardTitle className="text-lg">{tag}</CardTitle>
                  {doc?.tags?.find((t) => t.name === tag)?.description && <CardDescription>{doc.tags.find((t) => t.name === tag)!.description}</CardDescription>}
                </CardHeader>
                <CardContent className="divide-y">
                  {endpoints.filter((e) => e.tag === tag).map((e) => <EndpointRow key={`${e.method} ${e.path}`} e={e} doc={doc} base={base} />)}
                </CardContent>
              </Card>
            ))
          )}
        </section>

        <Card data-testid="card-developers-crm">
          <CardHeader>
            <CardTitle className="text-lg">CRM API</CardTitle>
            <CardDescription>The CRM has its own keys (<code>chk_…</code>, created in the portal under Integrations) for its customers, projects, estimates, invoices and payments.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Both key types share the <code>/api/v1</code> base and the bearer header. The CRM's index is at <a href="/api/v1" className="underline underline-offset-4">/api/v1</a>; its webhooks are signed with <code>ConstructHUB-Signature</code>.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EndpointRow({ e, doc, base }: { e: Endpoint; doc: OpenApiDoc | undefined; base: string }) {
  const body = e.op.requestBody?.content?.["application/json"]?.schema;
  const bodySchema = resolve(body, doc);
  const id = `${e.method}-${e.path}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const relative = e.path.replace(/^\/api\/v1/, "");
  return (
    <details className="py-3 group" data-testid={`endpoint-${id}`}>
      <summary className="flex flex-wrap items-center gap-2 cursor-pointer list-none">
        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${METHOD_CLASS[e.method]}`}>{e.method}</span>
        <code className="text-sm break-all">{e.path}</code>
        {e.op["x-scope"] && <Badge variant="outline" className="text-[10px]">{String(e.op["x-scope"])}</Badge>}
        {e.op.deprecated && <Badge variant="destructive" className="text-[10px]">Deprecated</Badge>}
        {e.op.summary && <span className="text-sm text-muted-foreground basis-full sm:basis-auto">{e.op.summary}</span>}
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        {e.op.description && <p className="text-muted-foreground whitespace-pre-line">{e.op.description}</p>}
        {e.op["x-units"] !== undefined && <p className="text-xs text-muted-foreground">Cost: {String(e.op["x-units"])} unit(s).</p>}
        {!!e.op.parameters?.length && (
          <div>
            <p className="font-medium mb-1">Parameters</p>
            <ul className="space-y-1">
              {e.op.parameters.map((p) => (
                <li key={`${p.in}-${p.name}`} className="flex flex-wrap gap-x-2">
                  <code className="break-all">{p.name}</code>
                  <span className="text-xs text-muted-foreground">{p.in}{p.required ? ", required" : ""}{p.schema ? ` · ${schemaType(p.schema, doc)}` : ""}</span>
                  {p.description && <span className="text-muted-foreground basis-full">{p.description}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {bodySchema && (
          <div>
            <p className="font-medium mb-1">Request body <span className="text-xs text-muted-foreground font-normal">application/json{e.op.requestBody?.required ? ", required" : ""}</span></p>
            {bodySchema.properties ? (
              <ul className="space-y-1">
                {Object.entries(bodySchema.properties).map(([name, s]) => (
                  <li key={name} className="flex flex-wrap gap-x-2">
                    <code className="break-all">{name}</code>
                    <span className="text-xs text-muted-foreground">{schemaType(s, doc)}{bodySchema.required?.includes(name) ? ", required" : ""}</span>
                    {s.description && <span className="text-muted-foreground basis-full">{s.description}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted-foreground">{schemaType(bodySchema, doc)}</p>}
          </div>
        )}
        {e.op.responses && (
          <div>
            <p className="font-medium mb-1">Responses</p>
            <ul className="space-y-0.5">
              {Object.entries(e.op.responses).map(([code, r]) => (
                <li key={code} className="text-muted-foreground"><code>{code}</code>{r?.description ? ` — ${r.description}` : ""}</li>
              ))}
            </ul>
          </div>
        )}
        {e.method === "get" && (
          <pre className="rounded-lg bg-muted p-3 text-xs overflow-x-auto">{`curl "${base}${relative}" -H "Authorization: Bearer chub_abc123_YOUR_SECRET"`}</pre>
        )}
      </div>
    </details>
  );
}
