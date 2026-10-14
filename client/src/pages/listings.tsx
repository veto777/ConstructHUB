import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import { Link } from "wouter";
import { AppPage, PageHeader, Section } from "@/components/app-ui";
import { useAgencyFilter } from "@/components/agency-workspace";
import { useUrlParam } from "@/hooks/use-url-param";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Catalogue,
  ListingsTable,
  LoadError,
  Summary,
  dateLabel,
  getJson,
  label,
  refreshListings,
  selectClass,
} from "@/components/listings/common";
import { ProfileForm } from "@/components/listings/profile-form";
import type { Directory, ListingProfile, ListingEvent } from "@shared/listings";

type Location = {
  id: number;
  businessName: string;
  city: string | null;
  gbpLocationName: string | null;
};
function AddListing({
  profileId,
  directories,
}: {
  profileId: number;
  directories: Directory[];
}) {
  const [open, setOpen] = useState(false);
  const [directoryId, setDirectoryId] = useState("");
  const [url, setUrl] = useState("");
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/listings", {
        profile_id: profileId,
        directory_id: Number(directoryId),
        listing_url: url,
      }),
    onSuccess: async () => {
      await refreshListings();
      setOpen(false);
      setUrl("");
      setDirectoryId("");
      toast({
        title: "Directory profile added",
        description: "Re-check it to compare your business details.",
      });
    },
  });
  return (
    <>
      <Button
        onClick={() => {
          mutation.reset();
          setOpen(true);
        }}
      >
        Add a listing URL
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a directory profile URL</DialogTitle>
            <DialogDescription>
              Use an existing page for your business on the selected directory.
              This does not submit a new business listing.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            <label className="block text-sm">
              Directory
              <select
                aria-label="Directory"
                required
                className={selectClass}
                value={directoryId}
                onChange={(event) => setDirectoryId(event.target.value)}
              >
                <option value="">Choose a directory</option>
                {directories
                  .filter((directory) => directory.active && directory.domain)
                  .map((directory) => (
                    <option key={directory.id} value={directory.id}>
                      {directory.name} · {directory.domain}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm">
              Listing URL
              <Input
                required
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            {mutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {apiErrorMessage(mutation.error)}
              </p>
            )}
            <Button
              type="submit"
              disabled={mutation.isPending || !directoryId || !url}
            >
              {mutation.isPending ? "Adding…" : "Add URL"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
function Activity({ locationId }: { locationId: number }) {
  const [after, setAfter] = useState("0");
  const url = `/api/listings/profiles/${locationId}/events?limit=50&after=${after}`;
  const query = useQuery<ListingEvent[]>({
    queryKey: [url],
    queryFn: () => getJson(url),
  });
  return (
    <>
      <LoadError error={query.error} retry={() => void query.refetch()} />
      {query.isLoading && <p role="status">Loading activity…</p>}
      {query.data && (
        <>
          <ol className="divide-y">
            {query.data.map((event) => (
              <li key={event.id} className="py-3 text-sm">
                <p className="font-medium capitalize">
                  {label(event.type)}
                  {event.listing_id ? ` · Listing ${event.listing_id}` : ""}
                </p>
                <p className="text-muted-foreground">{dateLabel(event.at)}</p>
                {event.detail?.fields && (
                  <p>Fields: {event.detail.fields.map(label).join(", ")}</p>
                )}
                {event.detail?.status && <p>{label(event.detail.status)}</p>}
                {event.detail?.evidence?.reason && (
                  <p>{event.detail.evidence.reason}</p>
                )}
              </li>
            ))}
          </ol>
          {!query.data.length && (
            <p className="py-4 text-sm text-muted-foreground">
              No activity on this page yet.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={after === "0"}
              onClick={() => setAfter("0")}
            >
              First events
            </Button>
            <Button
              variant="outline"
              disabled={query.data.length < 50}
              onClick={() => setAfter(String(query.data.at(-1)!.id))}
            >
              Later events
            </Button>
          </div>
        </>
      )}
    </>
  );
}
function LocationListings({
  location,
  directories,
}: {
  location: Location;
  directories: Directory[];
}) {
  const url = `/api/listings/profiles/${location.id}`;
  const query = useQuery<ListingProfile | null>({
    queryKey: [url],
    queryFn: () => getJson(url),
  });
  return (
    <div className="space-y-6">
      <Section title="Overview">
        <Summary locationId={location.id} />
      </Section>
      <Section
        title="Business profile"
        description="The name, address, phone, and other details you want directories to show."
      >
        <LoadError error={query.error} retry={() => void query.refetch()} />
        {query.isLoading && <p role="status">Loading business profile…</p>}
        {query.isSuccess && (
          <ProfileForm
            profile={query.data}
            locationId={location.id}
            googleLinked={!!location.gbpLocationName}
          />
        )}
      </Section>
      <Section
        title="Directory profiles"
        description="Your business pages on each directory, checked against your profile."
      >
        <div className="mb-4">
          {query.data ? (
            <AddListing profileId={query.data.id} directories={directories} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Save a business profile before adding listing URLs.
            </p>
          )}
        </div>
        <ListingsTable locationId={location.id} />
      </Section>
      <Section
        title="Activity"
        description="Profile updates and directory checks, in time order."
      >
        <Activity locationId={location.id} />
      </Section>
    </div>
  );
}
export default function ListingsPage() {
  const filter = useAgencyFilter();
  const locations = useQuery<Location[]>({
    queryKey: [`/api/locations?${filter.params}`],
  });
  const [selected, setSelected] = useUrlParam("location");
  const chosen = locations.data?.find(
    (location) => String(location.id) === selected,
  );
  const directories = useQuery<Directory[]>({
    queryKey: ["/api/listings/directories"],
    queryFn: () => getJson("/api/listings/directories"),
  });
  return (
    <AppPage width="wide" testId="page-listings" className="space-y-6 pb-16">
      <PageHeader
        icon={ListChecks}
        title="Directory Sync"
        description="Keep your name, address, and phone (NAP) consistent across business directories."
      />
      <Section title="Business location">
        <LoadError
          error={locations.error}
          retry={() => void locations.refetch()}
        />
        <label className="block max-w-lg text-sm">
          Location
          <select
            aria-label="Location"
            className={selectClass}
            value={chosen ? String(chosen.id) : ""}
            onChange={(event) => setSelected(event.target.value || null)}
          >
            <option value="">
              {locations.isLoading ? "Loading locations…" : "Choose a location"}
            </option>
            {locations.data?.map((location) => (
              <option key={location.id} value={location.id}>
                {location.businessName}
                {location.city ? ` · ${location.city}` : ""}
              </option>
            ))}
          </select>
        </label>
        {locations.isSuccess && !locations.data.length && (
          <p className="mt-3 text-sm text-muted-foreground">
            No business locations yet.{" "}
            <Link href="/locations" className="text-primary underline">
              Add a location
            </Link>{" "}
            to start.
          </p>
        )}
        {!chosen && !!locations.data?.length && (
          <p className="mt-3 text-sm text-muted-foreground">
            Choose a location to view its profile, listings, and activity.
          </p>
        )}
      </Section>
      {chosen && (
        <LocationListings
          key={chosen.id}
          location={chosen}
          directories={directories.data ?? []}
        />
      )}
      <Section title="Directory catalogue">
        <LoadError
          error={directories.error}
          retry={() => void directories.refetch()}
        />
        {directories.isLoading && <p role="status">Loading directories…</p>}
        {directories.data && <Catalogue directories={directories.data} />}
      </Section>
    </AppPage>
  );
}
