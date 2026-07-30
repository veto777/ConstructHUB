import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Users, Plus, Search, Loader2, Mail, Phone, MapPin, ArrowRight, AlertTriangle } from "lucide-react";

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
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-7 w-7" /> Clients
          </h1>
          <p className="text-muted-foreground mt-1">
            Every client gets their own portal the moment you create them.
          </p>
        </div>
        {canManage && (
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
        )}
      </div>

      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search name, email, phone or address"
          value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search-clients" />
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : isError ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Couldn't load clients
            </CardTitle>
            <CardDescription>Check your connection and refresh the page.</CardDescription>
          </CardHeader>
        </Card>
      ) : !clients?.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">No clients yet</CardTitle>
            <CardDescription>
              {canManage ? "Create your first client to get started." : "Nobody has added a client yet."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-2">
          {clients.map((c) => (
            <Link key={c.id} href={`/crm/clients/${c.id}`}>
              <Card className="hover:bg-accent transition-colors cursor-pointer" data-testid={`client-${c.id}`}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {c.displayName}
                      {c.companyName && <Badge variant="outline">{c.companyName}</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 mt-1">
                      {c.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span>}
                      {c.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>}
                      {(c.addressLine1 || c.city) && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {[c.addressLine1, c.city, c.state].filter(Boolean).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
