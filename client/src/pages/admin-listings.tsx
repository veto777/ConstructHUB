import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import { AppPage, PageHeader, Section } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Catalogue,
  ListingsTable,
  LoadError,
  Pager,
  getJson,
  label,
  refreshListings,
  selectClass,
} from "@/components/listings/common";
import {
  DIRECTORY_CATEGORIES,
  DIRECTORY_KINDS,
  TIER_LABELS,
  type Directory,
  type ListingProfile,
} from "@shared/listings";

type AdminProfile = ListingProfile & {
  account_email: string;
  total: number;
  live: number;
  billable: number;
};
const requirementLabels = {
  requires_street_address: "Street address required",
  requires_phone_verification: "Phone verification required",
  requires_postcard: "Postcard required",
  paid: "Paid directory",
} as const;
function DirectoryForm({
  directory,
  onDone,
}: {
  directory: Directory | null;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(
    directory
      ? { ...directory }
      : {
          name: "",
          domain: "",
          kind: "submission",
          tier: 4,
          category: "general",
          source: "",
          active: true,
        },
  );
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const set = (key: string, value: unknown) => {
    setDraft((old) => ({ ...old, [key]: value }));
    setChanged((old) => new Set([...old, key]));
  };
  const mutation = useMutation({
    mutationFn: () => {
      const keys = directory
        ? [...changed]
        : [
            "name",
            "domain",
            "kind",
            "tier",
            "category",
            "source",
            "active",
            ...changed,
          ];
      const body = Object.fromEntries(
        [...new Set(keys)].map((key) => [
          key,
          key === "domain" && !draft[key]
            ? null
            : (key === "trades" || key === "states") &&
                Array.isArray(draft[key])
              ? (draft[key] as string[])
                  .map((entry) =>
                    key === "states"
                      ? entry.trim().toUpperCase()
                      : entry.trim(),
                  )
                  .filter(Boolean)
              : draft[key],
        ]),
      );
      return apiRequest(
        directory ? "PATCH" : "POST",
        `/api/listings/directories${directory ? `/${directory.id}` : ""}`,
        body,
      );
    },
    onSuccess: async () => {
      await refreshListings();
      toast({ title: "Directory saved" });
      onDone();
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {(
          [
            ["name", "Directory name"],
            ["domain", "Domain"],
            ["source", "Source URL"],
          ] as const
        ).map(([key, title]) => (
          <label key={key} className="text-sm">
            {title}
            <Input
              aria-label={title}
              required={key !== "domain"}
              type={
                key === "source" && (!directory || changed.has("source"))
                  ? "url"
                  : "text"
              }
              value={String(draft[key] ?? "")}
              onChange={(event) => set(key, event.target.value)}
            />
            {key === "domain" && (
              <span className="text-xs text-muted-foreground">
                Leave empty if unconfirmed. A domain used by listings cannot
                change.
              </span>
            )}
            {key === "source" && (
              <span className="text-xs text-muted-foreground">
                Use a public research source URL. Existing source labels are
                preserved unless edited.
              </span>
            )}
          </label>
        ))}
        <label className="text-sm">
          Tier
          <select
            className={selectClass}
            value={String(draft.tier)}
            onChange={(event) => set("tier", Number(event.target.value))}
          >
            {Object.entries(TIER_LABELS).map(([value, title]) => (
              <option value={value} key={value}>
                {value} · {title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Category
          <select
            className={selectClass}
            value={String(draft.category)}
            onChange={(event) => set("category", event.target.value)}
          >
            {DIRECTORY_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Delivery method
          <select
            className={selectClass}
            value={String(draft.kind)}
            onChange={(event) => set("kind", event.target.value)}
          >
            {DIRECTORY_KINDS.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </label>
        {(
          [
            ["trades", "Trades (one per line)"],
            ["states", "States (two-letter codes, one per line)"],
          ] as const
        ).map(([key, title]) => (
          <label key={key} className="text-sm">
            {title}
            <Textarea
              aria-label={title}
              value={(draft[key] as string[] | undefined)?.join("\n") ?? ""}
              onChange={(event) =>
                set(
                  key,
                  event.target.value ? event.target.value.split("\n") : null,
                )
              }
            />
          </label>
        ))}
        {Object.entries(requirementLabels).map(([key, title]) => (
          <label key={key} className="text-sm">
            {title}
            <select
              className={selectClass}
              value={draft[key] == null ? "" : String(draft[key])}
              onChange={(event) =>
                set(
                  key,
                  event.target.value === ""
                    ? null
                    : event.target.value === "true",
                )
              }
            >
              <option value="">Unknown</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
        ))}
      </div>
      <label className="block text-sm">
        Research notes
        <Textarea
          aria-label="Research notes"
          value={String(draft.notes ?? "")}
          onChange={(event) => set("notes", event.target.value || null)}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.active === true}
          onChange={(event) => set("active", event.target.checked)}
        />
        Active
      </label>
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {apiErrorMessage(mutation.error)}
        </p>
      )}
      <Button disabled={mutation.isPending || (!!directory && !changed.size)}>
        {mutation.isPending ? "Saving…" : "Save directory"}
      </Button>
    </form>
  );
}
function DirectoriesTab() {
  const query = useQuery<Directory[]>({
    queryKey: ["/api/listings/directories"],
    queryFn: () => getJson("/api/listings/directories"),
  });
  const [editing, setEditing] = useState<Directory | null | undefined>(
    undefined,
  );
  const { toast } = useToast();
  const toggle = useMutation({
    mutationFn: (directory: Directory) =>
      apiRequest("PATCH", `/api/listings/directories/${directory.id}`, {
        active: !directory.active,
      }),
    onSuccess: refreshListings,
    onError: (error) =>
      toast({
        title: "Could not update directory",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  const count = (key: "tier" | "category", value: string) =>
    query.data?.filter((directory) => String(directory[key]) === value)
      .length ?? 0;
  return (
    <Section
      title="Directory catalogue"
      description="Research coverage, edit directory details, and control which directories accept listing URLs."
    >
      <Button className="mb-4" onClick={() => setEditing(null)}>
        Add directory
      </Button>
      <LoadError error={query.error} retry={() => void query.refetch()} />
      {query.isLoading && <p role="status">Loading directories…</p>}
      {query.data && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(TIER_LABELS).map(([tier, title]) => (
              <div key={tier} className="rounded-lg border p-3">
                <p className="text-sm text-muted-foreground">
                  Tier {tier} · {title}
                </p>
                <p className="text-2xl font-semibold">{count("tier", tier)}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {DIRECTORY_CATEGORIES.map(
              (category) =>
                `${label(category)}: ${count("category", category)}`,
            ).join(" · ")}
          </p>
          <Catalogue
            directories={query.data}
            adminActions={(directory) => (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(directory)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(directory)}
                >
                  {directory.active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            )}
          />
        </div>
      )}
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.name}` : "Add directory"}
            </DialogTitle>
            <DialogDescription>
              Record researched information. Leave unconfirmed requirements and
              coverage empty.
            </DialogDescription>
          </DialogHeader>
          {editing !== undefined && (
            <DirectoryForm
              key={editing?.id ?? "new"}
              directory={editing}
              onDone={() => setEditing(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Section>
  );
}
function ProfilesTab() {
  const [offset, setOffset] = useState(0);
  const url = `/api/listings/admin/profiles?limit=50&offset=${offset}`;
  const query = useQuery<AdminProfile[]>({
    queryKey: [url],
    queryFn: () => getJson(url),
  });
  return (
    <Section
      title="Business profiles"
      description="Profiles across all accounts. Verification counts come from the listing checker."
    >
      <LoadError error={query.error} retry={() => void query.refetch()} />
      {query.isLoading && <p role="status">Loading profiles…</p>}
      {query.data && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {[
                    "Business",
                    "Account",
                    "Location",
                    "Total",
                    "Live",
                    "Billable",
                  ].map((title) => (
                    <th key={title} className="p-3 font-medium">
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {query.data.map((profile) => (
                  <tr key={profile.id}>
                    <td className="p-3 font-medium">
                      {profile.name ?? "Unnamed profile"}
                    </td>
                    <td className="p-3">
                      {profile.account_email}
                      <span className="block text-muted-foreground">
                        Account {profile.user_id}
                      </span>
                    </td>
                    <td className="p-3">{profile.location_id}</td>
                    <td className="p-3">{profile.total}</td>
                    <td className="p-3">{profile.live}</td>
                    <td className="p-3">{profile.billable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!query.data.length && (
              <p className="p-8 text-center text-muted-foreground">
                No profiles on this page.
              </p>
            )}
          </div>
          <Pager
            offset={offset}
            count={query.data.length}
            setOffset={setOffset}
          />
        </>
      )}
    </Section>
  );
}
export default function AdminListingsPage() {
  // This admin-only read gates every tab and uses apiRequest's existing recent-auth flow.
  const gate = useQuery<AdminProfile[]>({
    queryKey: ["/api/listings/admin/profiles?limit=1"],
    queryFn: () => getJson("/api/listings/admin/profiles?limit=1"),
    retry: false,
  });
  return (
    <AppPage width="wide" testId="page-admin-listings" className="space-y-6">
      <PageHeader
        icon={ListChecks}
        title="Listings administration"
        description="Manage directory research and review listing verification across accounts."
      />
      {gate.isLoading ? (
        <p role="status">Checking admin access…</p>
      ) : gate.error ? (
        <Section title="Platform admin access required">
          <LoadError error={gate.error} retry={() => void gate.refetch()} />
        </Section>
      ) : (
        <Tabs defaultValue="directories">
          <TabsList>
            <TabsTrigger value="directories">Directories</TabsTrigger>
            <TabsTrigger value="profiles">Profiles</TabsTrigger>
            <TabsTrigger value="listings">Listings</TabsTrigger>
          </TabsList>
          <TabsContent value="directories">
            <DirectoriesTab />
          </TabsContent>
          <TabsContent value="profiles">
            <ProfilesTab />
          </TabsContent>
          <TabsContent value="listings">
            <Section title="All listings">
              <ListingsTable admin />
            </Section>
          </TabsContent>
        </Tabs>
      )}
    </AppPage>
  );
}
