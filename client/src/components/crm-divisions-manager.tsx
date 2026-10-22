/**
 * Divisions — create, edit, set HQ and delete the company's operating arms
 * (name, code, address, contact, license, sales tax). Shared by Settings and
 * Team & Company → Divisions; writes need "Manage settings" (the API enforces it).
 */
import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, MapPin, Trash2 } from "lucide-react";
import { StatusPill, SectionTitle } from "@/components/crm-ui";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { divisionLabel, sortDivisions } from "@shared/divisions";

const emptyToNull = (s: string) => (s.trim() === "" ? null : s.trim());

/** A percent box → basis points, or an error to show (never silently clamped). */
function pctToBps(raw: string, label: string, max: number, min = 0): { bps: number | null; error?: string } {
  if (raw.trim() === "") return { bps: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { bps: null, error: `${label} must be a number.` };
  if (n < min || n > max) return { bps: null, error: `${label} must be between ${min}% and ${max}%.` };
  return { bps: Math.round(n * 100) };
}

export function CrmDivisionsManager({ onOpenWorkspace, onlyId, title = "Divisions" }: {
  /** Adds an "Open workspace" button per division (Team & Company → Divisions). */
  onOpenWorkspace?: (divisionId: string) => void;
  /** Show only this division (its own tab); the form appears when Edit is pressed. */
  onlyId?: string;
  title?: string;
}) {
  const { toast } = useToast();
  const { data: divisions, isError: divisionsError } = useQuery<any[]>({ queryKey: ["/api/crm/divisions"] });

  // ── Divisions ─────────────────────────────────────────────────────────────
  const emptyDivision = {
    name: "", code: "", email: "", phone: "", website: "",
    addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "",
    licenseNumber: "", licenseState: "", isHeadquarters: false,
    // Sales tax (custom_fields->taxRates): division default + per-city overrides.
    taxDefaultPct: "", taxCities: "",
    // custom_fields->offlinePaymentInstructions: this division's check / Zelle text.
    offlinePay: "",
  };
  const [divForm, setDivForm] = useState(emptyDivision);
  const [editingDivisionId, setEditingDivisionId] = useState<string | null>(null);
  // The add/edit form sits below the (possibly long) division list — Edit
  // scrolls it into view and focuses the first field.
  const divisionFormRef = useRef<HTMLDivElement>(null);
  const setD = (k: keyof typeof emptyDivision) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDivForm((d) => ({ ...d, [k]: e.target.value }));

  // "Seattle: 10.1%" per line → { Seattle: 1010 } (basis points, at most
  // 30%). A rate over 30% is refused with a message, never clamped.
  const parseCityRates = (s: string) => {
    const out: Record<string, number> = {};
    for (const line of s.split(/\n+/)) {
      const m = /^\s*([^:]+?)\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*%?\s*$/.exec(line);
      if (!m) continue;
      const pct = parseFloat(m[2]);
      if (pct > 30) throw new Error(`${m[1]} sales tax must be between 0% and 30%.`);
      out[m[1]] = Math.round(pct * 100);
    }
    return out;
  };
  const serializeCityRates = (cities?: Record<string, number> | null) =>
    cities ? Object.entries(cities).map(([k, v]) => `${k}: ${v / 100}%`).join("\n") : "";

  const saveDivision = useMutation({
    mutationFn: async () => {
      const taxDefault = pctToBps(divForm.taxDefaultPct, "Division sales tax", 30);
      if (taxDefault.error) throw new Error(taxDefault.error);
      const taxRates = {
        default: taxDefault.bps,
        cities: parseCityRates(divForm.taxCities),
      };
      const hasTax = taxRates.default != null || Object.keys(taxRates.cities).length > 0;
      const body = {
        name: divForm.name.trim(),
        code: divForm.code.trim(),
        email: emptyToNull(divForm.email),
        phone: emptyToNull(divForm.phone),
        website: emptyToNull(divForm.website),
        addressLine1: emptyToNull(divForm.addressLine1),
        addressLine2: emptyToNull(divForm.addressLine2),
        city: emptyToNull(divForm.city),
        state: emptyToNull(divForm.state),
        postalCode: emptyToNull(divForm.postalCode),
        licenseNumber: emptyToNull(divForm.licenseNumber),
        licenseState: emptyToNull(divForm.licenseState),
        isHeadquarters: divForm.isHeadquarters,
      };
      if (editingDivisionId) {
        // taxRates is PATCH-only on the API (merged into custom_fields).
        return (await apiRequest("PATCH", `/api/crm/divisions/${editingDivisionId}`,
          { ...body, taxRates, offlinePaymentInstructions: emptyToNull(divForm.offlinePay) })).json();
      }
      const created = await (await apiRequest("POST", "/api/crm/divisions", body)).json();
      if ((hasTax || divForm.offlinePay.trim()) && created?.id) {
        await apiRequest("PATCH", `/api/crm/divisions/${created.id}`, { taxRates, offlinePaymentInstructions: emptyToNull(divForm.offlinePay) });
      }
      return created;
    },
    onSuccess: () => {
      setDivForm(emptyDivision);
      setEditingDivisionId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/divisions"] });
      toast({ title: editingDivisionId ? "Division updated" : "Division created" });
    },
    onError: (e: any) => toast({ title: "Could not save division", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const setHq = useMutation({
    mutationFn: async (id: string) =>
      (await apiRequest("PATCH", `/api/crm/divisions/${id}`, { isHeadquarters: true })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/divisions"] });
      toast({ title: "Headquarters updated" });
    },
    onError: (e: any) => toast({ title: "Could not update", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // The server refuses (409) while projects or members still point at the
  // division — that message says what to reassign, so it's shown as-is.
  // Deleting asks first in an AlertDialog naming the division.
  const [divisionToDelete, setDivisionToDelete] = useState<{ id: string; name: string; code: string } | null>(null);
  const deleteDivision = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/crm/divisions/${id}`, undefined)).json(),
    onSuccess: (_r: any, id: string) => {
      if (editingDivisionId === id) {
        setDivForm(emptyDivision);
        setEditingDivisionId(null);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/crm/divisions"] });
      toast({ title: "Division deleted" });
    },
    onError: (e: any) => toast({ title: "Could not delete division", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const startEditDivision = (d: any) => {
    const s = (v: any) => v ?? "";
    const taxRates = (d.customFields as any)?.taxRates;
    setDivForm({
      name: s(d.name), code: s(d.code), email: s(d.email), phone: s(d.phone), website: s(d.website),
      addressLine1: s(d.addressLine1), addressLine2: s(d.addressLine2),
      city: s(d.city), state: s(d.state), postalCode: s(d.postalCode),
      licenseNumber: s(d.licenseNumber), licenseState: s(d.licenseState),
      isHeadquarters: d.isHeadquarters === true,
      taxDefaultPct: taxRates?.default != null ? String(taxRates.default / 100) : "",
      taxCities: serializeCityRates(taxRates?.cities),
      offlinePay: s((d.customFields as any)?.offlinePaymentInstructions),
    });
    setEditingDivisionId(d.id);
    requestAnimationFrame(() => {
      divisionFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("div-name")?.focus({ preventScroll: true });
    });
  };

  return (
    <Card data-testid="card-divisions">
      <CardHeader>
        <SectionTitle
          icon={MapPin}
          title={title}
          infoKey="divisions"
          description="Operating arms of your company (e.g. a WA headquarters and a FL division). A project's division sets the name, address and license that print on its estimates and invoices — and admins can be scoped to one."
        />
      </CardHeader>
      <CardContent className="space-y-4">
        {divisionsError && (
          <p className="text-sm text-destructive">Couldn't load divisions — refresh to try again.</p>
        )}
        {divisions && divisions.length > 0 && (
          <div className="space-y-2">
            {sortDivisions(divisions).filter((d) => !onlyId || d.id === onlyId).map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
                data-testid={`row-division-${d.id}`}>
                <div className="min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2 min-w-0">
                    {/* The name truncates; the pills never get pushed off-screen. */}
                    <span className="truncate">{divisionLabel(d)}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">{d.name}</span>
                    {d.isHeadquarters && <StatusPill tone="info" className="shrink-0" data-testid={`pill-hq-${d.id}`}>HQ</StatusPill>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[d.addressLine1, d.city, d.state].filter(Boolean).join(", ") || "No address — falls back to the company's"}
                    {d.licenseNumber ? ` · License ${d.licenseNumber}${d.licenseState ? ` (${d.licenseState})` : ""}` : ""}
                    {d.website ? ` · ${d.website}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {onOpenWorkspace && (
                    <Button size="sm" onClick={() => onOpenWorkspace(d.id)} data-testid={`button-open-workspace-${d.code}`}>
                      Open workspace
                    </Button>
                  )}
                  {!d.isHeadquarters && (
                    <Button size="sm" variant="outline" onClick={() => setHq.mutate(d.id)}
                      disabled={setHq.isPending} data-testid={`button-set-hq-${d.id}`}>
                      Set as HQ
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => startEditDivision(d)}
                    data-testid={`button-edit-division-${d.id}`}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" title="Delete division" aria-label={`Delete division ${d.name}`}
                    disabled={deleteDivision.isPending}
                    onClick={() => setDivisionToDelete({ id: d.id, name: d.name, code: d.code })}
                    data-testid={`button-delete-division-${d.id}`}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {(!onlyId || editingDivisionId) && (
        <div ref={divisionFormRef} className="rounded-lg border bg-muted/30 p-4 space-y-3 scroll-mt-4"
          data-testid="form-division">
          <div className="text-sm font-medium">{editingDivisionId ? "Edit division" : "Add a division"}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="div-name">Name</Label>
              <Input id="div-name" placeholder="e.g. Alpine Exteriors — Florida"
                data-testid="input-division-name" value={divForm.name} onChange={setD("name")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="div-code">Code</Label>
              <Input id="div-code" placeholder="e.g. FL" data-testid="input-division-code"
                value={divForm.code} onChange={setD("code")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="div-address1">Address</Label>
              <Input id="div-address1" data-testid="input-division-address1"
                value={divForm.addressLine1} onChange={setD("addressLine1")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="div-city">City</Label>
              <Input id="div-city" data-testid="input-division-city"
                value={divForm.city} onChange={setD("city")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="div-state">State</Label>
                <Input id="div-state" data-testid="input-division-state"
                  value={divForm.state} onChange={setD("state")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="div-postal">ZIP</Label>
                <Input id="div-postal" data-testid="input-division-postal"
                  value={divForm.postalCode} onChange={setD("postalCode")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="div-license">License #</Label>
                <Input id="div-license" data-testid="input-division-license-number"
                  value={divForm.licenseNumber} onChange={setD("licenseNumber")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="div-license-state">License state</Label>
                <Input id="div-license-state" data-testid="input-division-license-state"
                  value={divForm.licenseState} onChange={setD("licenseState")} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="div-email">Email (optional)</Label>
              <Input id="div-email" type="email" data-testid="input-division-email"
                value={divForm.email} onChange={setD("email")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="div-phone">Phone (optional)</Label>
              <Input id="div-phone" data-testid="input-division-phone"
                value={divForm.phone} onChange={setD("phone")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="div-website">Website (optional)</Label>
              <Input id="div-website" data-testid="input-division-website" placeholder="https://…"
                value={divForm.website} onChange={setD("website")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="div-offline-pay">How to pay by check or Zelle (this division)</Label>
              <Textarea id="div-offline-pay" rows={3} maxLength={1500} data-testid="textarea-division-offline-pay"
                placeholder={"Checks payable to …, mailed to …\nZelle: …\nEmpty = the company-wide text in Settings → Payments"}
                value={divForm.offlinePay} onChange={(e) => setDivForm((d) => ({ ...d, offlinePay: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="div-tax-default">Sales tax — division default (%)</Label>
              <Input id="div-tax-default" type="number" min={0} max={30} step="0.1"
                data-testid="input-division-tax-default" placeholder="e.g. 7.0"
                value={divForm.taxDefaultPct} onChange={setD("taxDefaultPct")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="div-tax-cities">City tax overrides (one per line)</Label>
              <Textarea id="div-tax-cities" rows={2} data-testid="textarea-division-tax-cities"
                placeholder={"Seattle: 10.1%\nTacoma: 9.4%"}
                value={divForm.taxCities}
                onChange={(e) => setDivForm((d) => ({ ...d, taxCities: e.target.value }))} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Sales tax resolves city override → division default → company default (Estimate &amp;
            invoice defaults). Rates are managed here in Settings → Divisions — verify with your accountant.
          </p>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={divForm.isHeadquarters}
              onCheckedChange={(v) => setDivForm((d) => ({ ...d, isHeadquarters: v === true }))}
              data-testid="checkbox-division-hq"
            />
            This is the headquarters
          </label>
          <div className="flex justify-end gap-2">
            {editingDivisionId && (
              <Button variant="ghost" onClick={() => { setDivForm(emptyDivision); setEditingDivisionId(null); }}
                data-testid="button-cancel-division-edit">
                Cancel
              </Button>
            )}
            <Button onClick={() => saveDivision.mutate()}
              disabled={saveDivision.isPending || !divForm.name.trim() || !divForm.code.trim()}
              data-testid="button-save-division">
              {saveDivision.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingDivisionId ? "Save division" : "Add division"}
            </Button>
          </div>
        </div>
        )}

        <AlertDialog open={!!divisionToDelete} onOpenChange={(o) => { if (!o) setDivisionToDelete(null); }}>
          <AlertDialogContent data-testid="dialog-delete-division">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this division?</AlertDialogTitle>
              <AlertDialogDescription>
                {divisionToDelete ? `"${divisionToDelete.name}" (${divisionToDelete.code})` : "This division"} is
                removed for good. A division that projects or team members still use can't be deleted —
                reassign them first.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete-division">Cancel</AlertDialogCancel>
              <AlertDialogAction
                data-testid="button-confirm-delete-division"
                onClick={() => { if (divisionToDelete) deleteDivision.mutate(divisionToDelete.id); }}
              >
                Delete division
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
