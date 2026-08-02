import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Users, Plus, Search, Loader2, Mail, Phone, MapPin, ChevronRight } from "lucide-react";
import { CrmPage, CrmPageHeader, EmptyState, ErrorCard, InitialAvatar, crmTable, crmTableCards } from "@/components/crm-ui";

interface Client {
  id: string;
  displayName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  tags: string[] | null;
  portalLastSeenAt: string | null;
  createdAt: string | null;
}

const EMPTY = {
  displayName: "", firstName: "", lastName: "", companyName: "",
  email: "", phone: "", addressLine1: "", city: "", state: "", postalCode: "", notes: "",
};

export default function CrmClientsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const canManage = me?.permissions?.manageCustomers === true;

  const { data: clients, isLoading, isError } = useQuery<Client[]>({
    queryKey: ["/api/crm/customers", q ? `?q=${encodeURIComponent(q)}` : ""],
    queryFn: async () => {
      const r = await fetch(`/api/crm/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const body: any = { ...form };
      // Fall back to a sensible display name rather than rejecting the form.
      if (!body.displayName.trim()) {
        body.displayName = [form.firstName, form.lastName].filter(Boolean).join(" ").trim() || form.companyName;
      }
      for (const k of Object.keys(body)) if (body[k] === "") body[k] = null;
      if (!body.displayName) throw new Error("A client name is required");
      return (await apiRequest("POST", "/api/crm/customers", body)).json();
    },
    onSuccess: () => {
      setOpen(false);
      setForm({ ...EMPTY });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      toast({ title: "Client created", description: "Their portal was created automatically." });
    },
    onError: (e: any) => toast({ title: "Could not create client", description: String(e.message ?? e), variant: "destructive" }),
  });

  return (
    <CrmPage>
      <CrmPageHeader
        icon={Users}
        title="Clients"
        infoKey="clients"
        subtitle="Every client gets their own portal the moment you create them."
        actions={canManage ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-client"><Plus className="h-4 w-4 mr-2" /> New client</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New client</DialogTitle></DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="c-name">Client name *</Label>
                  <Input id="c-name" data-testid="input-client-name" value={form.displayName}
                    placeholder="Joe & Mary Kane"
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="c-company">Company (optional)</Label>
                  <Input id="c-company" value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="c-email">Email</Label>
                  <Input id="c-email" type="email" data-testid="input-client-email" value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="c-phone">Phone</Label>
                  <Input id="c-phone" value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="c-addr">Service address</Label>
                  <Input id="c-addr" value={form.addressLine1}
                    onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="c-city">City</Label>
                  <Input id="c-city" value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="c-state">State</Label>
                    <Input id="c-state" value={form.state}
                      onChange={(e) => setForm({ ...form, state: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="c-zip">ZIP</Label>
                    <Input id="c-zip" value={form.postalCode}
                      onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="c-notes">Notes</Label>
                  <Textarea id="c-notes" rows={3} value={form.notes}
                    placeholder="Where's the leak? What did they ask for?"
                    onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => create.mutate()} disabled={create.isPending} data-testid="button-save-client">
                  {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create client
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : undefined}
      />

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
        <Input className="pl-9 bg-card" placeholder="Search name, email, phone or address"
          value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search-clients" />
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : isError ? (
        <ErrorCard title="Couldn't load clients" description="Check your connection and refresh the page." />
      ) : !clients?.length ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No clients yet"
            description={canManage
              ? "Create your first client — their portal is generated automatically."
              : "Nobody has added a client yet."}
            action={canManage ? (
              <Button onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> New client
              </Button>
            ) : undefined}
          />
        </Card>
      ) : (
        <div className={crmTable.wrapper}>
          <table className={crmTable.table}>
            <thead className={`${crmTable.thead} ${crmTableCards.thead}`}>
              <tr>
                <th className={crmTable.th}>Client</th>
                <th className={crmTable.th}>Contact</th>
                <th className={`${crmTable.th} hidden sm:table-cell`}>Address</th>
                <th className={`${crmTable.th} hidden sm:table-cell`}>Added</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className={`${crmTable.tr} ${crmTableCards.tr} cursor-pointer`}
                  onClick={() => navigate(`/crm/clients/${c.id}`)}
                  data-testid={`client-${c.id}`}>
                  <td className={crmTableCards.td}>
                    <div className="flex items-center gap-3 min-w-0">
                      <InitialAvatar name={c.displayName} />
                      <div className="min-w-0">
                        <Link href={`/crm/clients/${c.id}`}>
                          <span className="font-medium truncate text-primary hover:underline cursor-pointer block">{c.displayName}</span>
                        </Link>
                        {c.companyName && (
                          <div className="text-xs text-muted-foreground truncate">{c.companyName}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className={crmTableCards.td}>
                    <div className="space-y-0.5 text-sm">
                      {c.email && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Mail className="h-3 w-3 shrink-0" /><span className="truncate">{c.email}</span>
                        </div>
                      )}
                      {c.phone && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Phone className="h-3 w-3 shrink-0" />{c.phone}
                        </div>
                      )}
                      {!c.email && !c.phone && <span className="text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className={`${crmTable.td} hidden sm:table-cell`}>
                    {(c.addressLine1 || c.city) ? (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{[c.addressLine1, c.city, c.state].filter(Boolean).join(", ")}</span>
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={`${crmTable.td} hidden sm:table-cell text-sm text-muted-foreground whitespace-nowrap`}>
                    {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="hidden sm:table-cell sm:px-4 sm:py-3 sm:pr-3 align-middle">
                    <Link href={`/crm/clients/${c.id}`}>
                      <ChevronRight className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CrmPage>
  );
}
