import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  UploadCloud, Users, FileText, Receipt, Loader2, ArrowRight, ArrowLeft,
  CheckCircle2, AlertTriangle, Handshake,
} from "lucide-react";
import { CrmPage, CrmPageHeader, StatusPill, SectionTitle, crmTable } from "@/components/crm-ui";

/**
 * Migration center — "bring your data with you". Self-serve CSV/TSV import
 * (preview → map columns → import) for contractors leaving Jobber, Leap,
 * QuickBooks or Excel, plus the honest assisted path: a human does it.
 */

type Entity = "customers" | "estimates" | "invoices";

const ENTITIES: { key: Entity; label: string; icon: any; blurb: string }[] = [
  { key: "customers", label: "Clients", icon: Users, blurb: "name, email, phone, address, notes — Jobber, QuickBooks or any spreadsheet export" },
  { key: "estimates", label: "Estimates", icon: FileText, blurb: "matched to clients you already imported" },
  { key: "invoices", label: "Invoices", icon: Receipt, blurb: "totals, amounts paid and status — matched to clients" },
];

/** Mirror of the server's field lists (labels only — mapping itself is server-side). */
const FIELDS: Record<Entity, { key: string; label: string }[]> = {
  customers: [
    { key: "displayName", label: "Name" },
    { key: "firstName", label: "First name" },
    { key: "lastName", label: "Last name" },
    { key: "companyName", label: "Company" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "altPhone", label: "Alt phone" },
    { key: "addressLine1", label: "Address" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "postalCode", label: "Zip / postal code" },
    { key: "notes", label: "Notes" },
  ],
  estimates: [
    { key: "customerName", label: "Client name" },
    { key: "customerEmail", label: "Client email" },
    { key: "title", label: "Title" },
    { key: "number", label: "Estimate #" },
    { key: "status", label: "Status" },
    { key: "total", label: "Total" },
  ],
  invoices: [
    { key: "customerName", label: "Client name" },
    { key: "customerEmail", label: "Client email" },
    { key: "title", label: "Title" },
    { key: "number", label: "Invoice #" },
    { key: "status", label: "Status" },
    { key: "total", label: "Total" },
    { key: "paid", label: "Amount paid" },
  ],
};

const SKIP = "__skip__";
const MAX_BYTES = 2 * 1024 * 1024;

interface PreviewResponse {
  entity: Entity;
  headers: string[];
  mapping: Record<string, string | null>;
  totalRows: number;
  rows: string[][];
  errors: { row: number; message: string }[];
}

interface ImportResponse {
  created: number;
  skipped: number;
  errors: number;
  results: { row: number; status: "created" | "skipped" | "error"; id?: string; message?: string }[];
  hint?: string;
}

export default function CrmMigratePage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [entity, setEntity] = useState<Entity>("customers");
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<ImportResponse | null>(null);

  // ── Assisted path ─────────────────────────────────────────────────────────
  const [system, setSystem] = useState("jobber");
  const [note, setNote] = useState("");
  const [assistedSent, setAssistedSent] = useState(false);

  const reset = (e: Entity) => {
    setEntity(e);
    setFileName(null);
    setCsv(null);
    setPreview(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast({
        title: "File is over 2 MB",
        description: "Split it into smaller files, or use the assisted import below and we'll pull it for you.",
        variant: "destructive",
      });
      return;
    }
    const text = await f.text();
    setCsv(text);
    setFileName(f.name);
    setPreview(null);
    setResult(null);
  };

  const doPreview = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/migrate/preview", { entity, csv })).json(),
    onSuccess: (data: PreviewResponse) => {
      setPreview(data);
      setMapping(data.mapping);
      setResult(null);
    },
    onError: (e: any) =>
      toast({ title: "Could not read that file", description: String(e.message ?? e), variant: "destructive" }),
  });

  const doImport = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/crm/migrate/import", {
          entity,
          mapping,
          headers: preview?.headers,
          rows: preview?.rows,
        })
      ).json(),
    onSuccess: (data: ImportResponse) => {
      setResult(data);
      if (entity === "customers") queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      if (entity === "estimates") queryClient.invalidateQueries({ queryKey: ["/api/crm/estimates"] });
    },
    onError: (e: any) =>
      toast({ title: "Import failed", description: String(e.message ?? e), variant: "destructive" }),
  });

  const requestAssisted = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/migrate/assisted", { system, note })).json(),
    onSuccess: () => setAssistedSent(true),
    onError: (e: any) =>
      toast({ title: "Request not sent", description: String(e.message ?? e), variant: "destructive" }),
  });

  // Map raw rows through the current mapping for the preview table.
  const mappedPreview = useMemo(() => {
    if (!preview) return [];
    const fields = FIELDS[entity];
    return preview.rows.slice(0, 8).map((row) =>
      fields.map((f) => {
        const header = mapping[f.key];
        if (!header) return "";
        const idx = preview.headers.indexOf(header);
        return idx === -1 ? "" : (row[idx] ?? "");
      }),
    );
  }, [preview, mapping, entity]);

  const errorByRow = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const e of preview?.errors ?? []) {
      m.set(e.row, [...(m.get(e.row) ?? []), e.message]);
    }
    return m;
  }, [preview]);

  return (
    <CrmPage>
      <CrmPageHeader
        icon={UploadCloud}
        title="Bring your data with you"
        subtitle="Import clients, estimates and invoices from Jobber, QuickBooks, Leap or any spreadsheet — no copy-paste marathon."
      />

      {/* ── Step 1: what are we importing ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <SectionTitle icon={UploadCloud} title="1 · Pick what you're importing"
            description="Clients first — estimates and invoices attach themselves to the clients you already have." />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {ENTITIES.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => reset(e.key)}
                data-testid={`button-entity-${e.key}`}
                className={`rounded-lg border p-4 text-left transition-colors hover:border-primary/50 ${
                  entity === e.key ? "border-primary bg-primary/5" : "bg-card"
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <e.icon className="h-4 w-4 text-primary" strokeWidth={1.8} />
                  {e.label}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{e.blurb}</div>
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="migrate-file">CSV or TSV export (max 2 MB, 5,000 rows)</Label>
            <input
              id="migrate-file"
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
              data-testid="input-migrate-file"
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted"
              onChange={(ev) => void onFile(ev.target.files?.[0])}
            />
            <p className="text-xs text-muted-foreground">
              Comma or tab separated, quoted fields are fine — the Jobber client export and the
              QuickBooks customer list both work as-is.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => doPreview.mutate()}
              disabled={!csv || doPreview.isPending}
              data-testid="button-preview"
            >
              {doPreview.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Preview {fileName ? `· ${fileName}` : ""}
            </Button>
            {csv && (
              <span className="text-xs text-muted-foreground" data-testid="text-file-ready">
                {fileName} ready
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Step 2: mapping + preview ───────────────────────────────────── */}
      {preview && (
        <Card>
          <CardHeader>
            <SectionTitle icon={FileText} title="2 · Check the column mapping"
              description="We guessed from the headers — fix anything that looks off before importing." />
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center gap-2" data-testid="text-preview-summary">
              <StatusPill tone="info" dot={false}>{preview.totalRows} rows</StatusPill>
              <StatusPill tone={preview.errors.length ? "warning" : "success"} dot={false}>
                {preview.errors.length ? `${preview.errors.length} rows need attention` : "all rows valid"}
              </StatusPill>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS[entity].map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label className="text-xs">{f.label}</Label>
                  <Select
                    value={mapping[f.key] ?? SKIP}
                    onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === SKIP ? null : v }))}
                  >
                    <SelectTrigger data-testid={`select-map-${f.key}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP}>— skip —</SelectItem>
                      {preview.headers.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className={crmTable.wrapper} data-testid="table-preview">
              <table className={crmTable.table}>
                <thead className={crmTable.thead}>
                  <tr>
                    <th className={crmTable.th}>#</th>
                    {FIELDS[entity].map((f) => (
                      <th key={f.key} className={crmTable.th}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mappedPreview.map((cells, i) => (
                    <tr key={i} className={crmTable.tr} data-testid={`preview-row-${i + 1}`}>
                      <td className={crmTable.td}>
                        <span className="text-xs text-muted-foreground">{i + 1}</span>
                        {errorByRow.get(i + 1) && (
                          <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400"
                            title={errorByRow.get(i + 1)!.join("; ")}>
                            <AlertTriangle className="inline h-3.5 w-3.5" />
                          </span>
                        )}
                      </td>
                      {cells.map((c, j) => (
                        <td key={j} className={`${crmTable.td} max-w-[180px] truncate`}>{c || "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.totalRows > 8 && (
              <p className="text-xs text-muted-foreground">Showing the first 8 of {preview.totalRows} rows.</p>
            )}

            {preview.errors.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
                data-testid="text-preview-errors">
                Rows with problems are skipped on import, not fatal:{" "}
                {preview.errors.slice(0, 5).map((e) => `#${e.row} ${e.message}`).join(" · ")}
                {preview.errors.length > 5 ? ` · …and ${preview.errors.length - 5} more` : ""}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={() => doImport.mutate()} disabled={doImport.isPending}
                data-testid="button-run-import">
                {doImport.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Import {preview.totalRows} rows
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 3: result ──────────────────────────────────────────────── */}
      {result && (
        <Card data-testid="card-import-result">
          <CardHeader>
            <SectionTitle icon={CheckCircle2} title="3 · Import finished" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2" data-testid="text-import-summary">
              <StatusPill tone="success" dot={false}>{result.created} created</StatusPill>
              <StatusPill tone="warning" dot={false}>{result.skipped} skipped (duplicates)</StatusPill>
              <StatusPill tone={result.errors ? "danger" : "neutral"} dot={false}>
                {result.errors} errors
              </StatusPill>
            </div>
            {result.results.some((r) => r.status !== "created") && (
              <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1 max-h-48 overflow-auto"
                data-testid="text-import-details">
                {result.results
                  .filter((r) => r.status !== "created")
                  .slice(0, 50)
                  .map((r) => (
                    <div key={r.row}>
                      Row {r.row}: {r.status === "skipped" ? "skipped" : "error"} — {r.message}
                    </div>
                  ))}
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              {entity === "customers" && (
                <Link href="/crm/clients" data-testid="link-view-clients"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  View your clients <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
              <button type="button" onClick={() => reset(entity)}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
                data-testid="button-import-another">
                <ArrowLeft className="h-3.5 w-3.5" /> Import another file
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Assisted path: honest, a human does it ──────────────────────── */}
      <Card>
        <CardHeader>
          <SectionTitle icon={Handshake} title="Coming from Jobber, Leap, or QuickBooks Online?"
            description="We'll pull it for you. No scripts to babysit — a human moves your data and checks it with you." />
        </CardHeader>
        <CardContent className="space-y-4">
          {assistedSent ? (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4"
              data-testid="text-assisted-confirmation">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium">Request received.</div>
                <p className="text-muted-foreground mt-0.5">
                  We'll reach out within 1 business day to schedule the pull. Keep your old
                  account active until we've confirmed everything landed.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Which system are you on?</Label>
                  <Select value={system} onValueChange={setSystem}>
                    <SelectTrigger data-testid="select-assisted-system">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="jobber">Jobber</SelectItem>
                      <SelectItem value="leap">Leap</SelectItem>
                      <SelectItem value="quickbooks">QuickBooks Online</SelectItem>
                      <SelectItem value="housecallpro">Housecall Pro</SelectItem>
                      <SelectItem value="other">Something else</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="assisted-note">Anything we should know? (optional)</Label>
                  <Textarea id="assisted-note" rows={2} data-testid="textarea-assisted-note"
                    placeholder="e.g. ~800 clients, 3 years of invoices"
                    value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={() => requestAssisted.mutate()}
                  disabled={requestAssisted.isPending} data-testid="button-request-assisted">
                  {requestAssisted.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Request a hands-on migration
                </Button>
                <span className="text-xs text-muted-foreground">
                  This emails our team — we'll reach out within 1 business day.
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </CrmPage>
  );
}
