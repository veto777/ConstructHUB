/**
 * Option tabs, estimate menu and templates for the New-estimate popup (owner, 2026-10-21, modelled on Housecall
 * Pro's "Option #1 | Add option" screen). The popup (pages/crm-client.tsx) owns the state; these are the controls.
 * Server side: server/crm/estimate-options.ts (option-set, duplicate, copy, templates, approval mode).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Copy, FileStack, MoreHorizontal, Pencil, Plus, Ban, Trash2, Undo2, Users, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";

export type OptionTabView = { key: string; name: string; cancelled: boolean };

export type OptionAction = "rename" | "duplicate" | "copy-same" | "copy-other" | "template" | "cancel" | "restore" | "delete";

/** "Option 1 | Option 2 | + Add option", each tab with its own menu. */
export function OptionTabsBar({ tabs, active, onSelect, onAdd, onAction, renamingIndex, onRename }: {
  tabs: OptionTabView[];
  active: number;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onAction: (i: number, a: OptionAction) => void;
  renamingIndex: number | null;
  onRename: (i: number, name: string | null) => void;
}) {
  const [draftName, setDraftName] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1 border-b" data-testid="option-tabs">
      {tabs.map((t, i) => (
        <div key={t.key} className={`flex items-center rounded-t-md border border-b-0 ${i === active ? "bg-background" : "bg-muted/50"}`}>
          {renamingIndex === i ? (
            <Input autoFocus className="h-8 w-40" value={draftName} data-testid={`input-option-name-${i}`}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); onRename(i, draftName.trim() || t.name); }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onRename(i, null); }
              }}
              onBlur={() => onRename(i, draftName.trim() || t.name)} />
          ) : (
            <button type="button" onClick={() => onSelect(i)} data-testid={`tab-option-${i}`}
              className={`px-3 py-1.5 text-sm ${i === active ? "font-semibold" : "text-muted-foreground"} ${t.cancelled ? "line-through opacity-60" : ""}`}
              title={t.cancelled ? "Cancelled — hidden from the client" : undefined}>
              {t.name}
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="px-1.5 py-1.5 text-muted-foreground hover:text-foreground" aria-label={`${t.name} menu`}
                data-testid={`button-option-menu-${i}`}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => { setDraftName(t.name); onAction(i, "rename"); }} data-testid={`menu-option-rename-${i}`}><Pencil className="h-4 w-4 mr-2" /> Rename</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction(i, "duplicate")} data-testid={`menu-option-duplicate-${i}`}><Copy className="h-4 w-4 mr-2" /> Copy to new option</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction(i, "copy-same")} data-testid={`menu-option-copy-same-${i}`}><FileStack className="h-4 w-4 mr-2" /> Copy to new estimate</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction(i, "copy-other")} data-testid={`menu-option-copy-other-${i}`}><Users className="h-4 w-4 mr-2" /> Copy to another client's estimate</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction(i, "template")} data-testid={`menu-option-template-${i}`}><LayoutTemplate className="h-4 w-4 mr-2" /> Save as template</DropdownMenuItem>
              <DropdownMenuSeparator />
              {tabs.length > 1 && (t.cancelled
                ? <DropdownMenuItem onSelect={() => onAction(i, "restore")} data-testid={`menu-option-restore-${i}`}><Undo2 className="h-4 w-4 mr-2" /> Restore option</DropdownMenuItem>
                : <DropdownMenuItem onSelect={() => onAction(i, "cancel")} data-testid={`menu-option-cancel-${i}`}><Ban className="h-4 w-4 mr-2" /> Cancel option</DropdownMenuItem>)}
              {tabs.length > 1 && (
                <DropdownMenuItem onSelect={() => onAction(i, "delete")} className="text-destructive" data-testid={`menu-option-delete-${i}`}><Trash2 className="h-4 w-4 mr-2" /> Delete option</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
      <button type="button" onClick={onAdd} className="px-3 py-1.5 text-sm text-primary hover:underline" data-testid="button-add-option">
        <Plus className="h-4 w-4 inline mr-1" />Add option
      </button>
    </div>
  );
}

export type EstimateAction = "duplicate" | "template" | "copy-other";

/** Estimate-level menu: duplicate, save as template, copy to another client. */
export function EstimateMenu({ onAction, disabled }: { onAction: (a: EstimateAction) => void; disabled?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} data-testid="button-estimate-menu">
          Estimate <ChevronDown className="h-4 w-4 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onAction("duplicate")} data-testid="menu-estimate-duplicate"><Copy className="h-4 w-4 mr-2" /> Duplicate estimate</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("template")} data-testid="menu-estimate-template"><LayoutTemplate className="h-4 w-4 mr-2" /> Save as template</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("copy-other")} data-testid="menu-estimate-copy-other"><Users className="h-4 w-4 mr-2" /> Copy to another client</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type EstimateTemplate = {
  id: string; name: string; title: string | null; introText: string | null; items: any[];
  offers: any[] | null; contractorDiscount: any | null;
};

/** Start from a template, or add one as an option. */
export function TemplatesMenu({ onUse, onAddAsOption }: { onUse: (t: EstimateTemplate) => void; onAddAsOption: (t: EstimateTemplate) => void }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<EstimateTemplate[]>({ queryKey: ["/api/crm/estimate-templates"], enabled: open });
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="button-templates">
          <LayoutTemplate className="h-4 w-4 mr-1" /> Templates <ChevronDown className="h-4 w-4 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto w-72">
        {!data?.length && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">No templates yet. Save one from the Estimate or an option's menu.</DropdownMenuLabel>}
        {(data ?? []).map((t) => (
          <div key={t.id} className="px-2 py-1.5 text-sm" data-testid={`template-${t.id}`}>
            <div className="font-medium truncate">{t.name}</div>
            <div className="flex gap-3 text-xs">
              <button type="button" className="text-primary hover:underline" onClick={() => { setOpen(false); onUse(t); }} data-testid={`button-use-template-${t.id}`}>Start from it</button>
              <button type="button" className="text-primary hover:underline" onClick={() => { setOpen(false); onAddAsOption(t); }} data-testid={`button-template-option-${t.id}`}>Add as option</button>
            </div>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Ask for a name (template, …). */
export function NameDialog({ open, title, label, initial, onCancel, onSubmit }: {
  open: boolean; title: string; label: string; initial: string; onCancel: () => void; onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); else setName(initial); }}>
      <DialogContent className="max-w-sm" onOpenAutoFocus={() => setName(initial)}>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{label}</DialogDescription></DialogHeader>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid="input-name-dialog"
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSubmit(name.trim()); }} />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={!name.trim()} onClick={() => onSubmit(name.trim())} data-testid="button-name-dialog-save">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Pick another client of the org. */
export function ClientPickerDialog({ open, onCancel, onPick, excludeId }: {
  open: boolean; onCancel: () => void; onPick: (c: { id: string; displayName: string }) => void; excludeId?: string;
}) {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/crm/customers", { q, picker: true }],
    queryFn: async () => (await apiRequest("GET", `/api/crm/customers?q=${encodeURIComponent(q)}`)).json(),
    enabled: open,
  });
  const rows: any[] = (Array.isArray(data) ? data : data?.rows ?? data?.customers ?? []).filter((c: any) => c.id !== excludeId).slice(0, 20);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Copy to which client?</DialogTitle><DialogDescription>A new draft estimate is made for the client you pick.</DialogDescription></DialogHeader>
        <Label htmlFor="client-pick">Search clients</Label>
        <Input id="client-pick" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, city…" data-testid="input-client-picker" />
        <div className="max-h-72 overflow-y-auto divide-y rounded-md border">
          {isLoading && <div className="p-3 text-sm text-muted-foreground">Searching…</div>}
          {!isLoading && !rows.length && <div className="p-3 text-sm text-muted-foreground">No clients found.</div>}
          {rows.map((c) => (
            <button key={c.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted" onClick={() => onPick({ id: c.id, displayName: c.displayName })}
              data-testid={`pick-client-${c.id}`}>
              <div className="font-medium">{c.displayName}</div>
              {(c.city || c.email) && <div className="text-xs text-muted-foreground">{[c.city, c.email].filter(Boolean).join(" · ")}</div>}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Delete option?" */
export function ConfirmDeleteOption({ name, onCancel, onConfirm }: { name: string | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <AlertDialog open={!!name} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>Its lines and scopes are removed from this estimate. To keep it but hide it from the client, cancel the option instead.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} data-testid="button-confirm-delete-option">Delete option</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
