import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import type { BusinessProfile } from "@shared/directories";
import { refreshDirectories, selectClass } from "./common";

type Field = {
  key: string;
  title: string;
  kind?: "list" | "long" | "url" | "number" | "structured";
  hint?: string;
};
const groups: { title: string; fields: Field[] }[] = [
  {
    title: "Business details",
    fields: [
      { key: "name", title: "Business name" },
      {
        key: "phone",
        title: "Phone",
        hint: "Use your business phone, not a tracking number.",
      },
      { key: "website", title: "Website", kind: "url" },
      { key: "year_founded", title: "Year founded", kind: "number" },
    ],
  },
  {
    title: "Address",
    fields: [
      { key: "street_address", title: "Street address" },
      { key: "address_line2", title: "Suite or unit" },
      { key: "city", title: "City" },
      { key: "state", title: "State" },
      { key: "postal_code", title: "ZIP code" },
      { key: "country", title: "Country" },
    ],
  },
  {
    title: "Hours & coverage",
    fields: [
      {
        key: "hours",
        title: "Regular hours",
        kind: "structured",
        hint: "Add a day and its opening hours. Leave unknown hours empty.",
      },
      {
        key: "holiday_hours",
        title: "Holiday hours",
        kind: "structured",
        hint: "Add a date and its hours or closure.",
      },
      { key: "service_areas", title: "Service areas", kind: "structured" },
    ],
  },
  {
    title: "Categories & services",
    fields: [
      { key: "primary_category", title: "Primary category" },
      { key: "secondary_categories", title: "Other categories", kind: "list" },
      { key: "services", title: "Services", kind: "structured" },
      { key: "short_description", title: "Short description", kind: "long" },
      { key: "long_description", title: "Full description", kind: "long" },
    ],
  },
  {
    title: "Credentials & payment methods",
    fields: [
      { key: "licence_numbers", title: "License numbers", kind: "list" },
      { key: "insurance_numbers", title: "Insurance numbers", kind: "list" },
      { key: "payment_methods", title: "Payment methods", kind: "list" },
    ],
  },
  {
    title: "Links & photos",
    fields: [
      { key: "social_links", title: "Social links", kind: "structured" },
      { key: "quote_link", title: "Booking or quote link", kind: "url" },
      { key: "review_link", title: "Review link", kind: "url" },
      {
        key: "logo_key",
        title: "Logo media key",
        hint: "Use an existing key for your own uploaded media.",
      },
      { key: "cover_photo_key", title: "Cover photo media key" },
      { key: "photo_keys", title: "Project photo media keys", kind: "list" },
    ],
  },
];

// Preserve Google's nested hours and service records while allowing simple manually entered records.
function StructuredValue({
  value,
  onChange,
  title,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  title: string;
}) {
  const [newKey, setNewKey] = useState("");
  if (value !== null && typeof value === "object") {
    const array = Array.isArray(value);
    const entries = Object.entries(value);
    return (
      <div className="space-y-2 rounded-md border p-3">
        {!entries.length && (
          <p className="text-xs text-muted-foreground">Nothing entered yet.</p>
        )}
        {entries.map(([key, item]) => (
          <div key={key} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs capitalize">
                {array ? `Item ${Number(key) + 1}` : key.replaceAll("_", " ")}
              </p>
              <StructuredValue
                title={`${title} ${key}`}
                value={item}
                onChange={(next) =>
                  onChange(
                    array
                      ? (value as unknown[]).map((old, index) =>
                          index === Number(key) ? next : old,
                        )
                      : { ...value, [key]: next },
                  )
                }
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Remove ${title} ${key}`}
              onClick={() =>
                onChange(
                  array
                    ? (value as unknown[]).filter(
                        (_, index) => index !== Number(key),
                      )
                    : Object.fromEntries(
                        entries.filter(([old]) => old !== key),
                      ),
                )
              }
            >
              Remove
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          {!array && (
            <Input
              aria-label={`New ${title} label`}
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
              placeholder="Day, date, or label"
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!array && (!newKey.trim() || newKey.trim() in value)}
            onClick={() => {
              onChange(
                array
                  ? [...(value as unknown[]), ""]
                  : { ...value, [newKey.trim()]: "" },
              );
              setNewKey("");
            }}
          >
            Add item
          </Button>
        </div>
      </div>
    );
  }
  if (typeof value === "boolean")
    return (
      <select
        aria-label={title}
        className={selectClass}
        value={String(value)}
        onChange={(event) => onChange(event.target.value === "true")}
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  return (
    <Input
      aria-label={title}
      type={typeof value === "number" ? "number" : "text"}
      value={String(value ?? "")}
      onChange={(event) =>
        onChange(
          typeof value === "number"
            ? Number(event.target.value)
            : event.target.value,
        )
      }
    />
  );
}

export function ProfileForm({
  profile,
  locationId,
  googleLinked,
}: {
  profile: BusinessProfile | null;
  locationId: number;
  googleLinked: boolean;
}) {
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const { toast } = useToast();
  const owned = new Set(profile?.owner_edited_fields ?? []);
  const value = (key: string) => (key in edits ? edits[key] : profile?.[key]);
  const change = (key: string, next: unknown) =>
    setEdits((current) => ({ ...current, [key]: next }));
  const mutation = useMutation({
    mutationFn: (action: "save" | "import") =>
      apiRequest(
        action === "save" ? "PUT" : "POST",
        `/api/directories/profiles/${locationId}${action === "import" ? "/import-from-gbp" : ""}`,
        action === "save"
          ? Object.fromEntries(
              Object.entries(edits).map(([key, entry]) => [
                key,
                groups.some((group) =>
                  group.fields.some(
                    (field) => field.key === key && field.kind === "list",
                  ),
                ) && Array.isArray(entry)
                  ? entry.map((item: string) => item.trim()).filter(Boolean)
                  : entry,
              ]),
            )
          : undefined,
      ),
    onSuccess: async (_, action) => {
      setEdits({});
      await refreshDirectories();
      toast({
        title:
          action === "save"
            ? "Business profile saved"
            : "Google details imported",
        description: "Existing directory profiles need a fresh check.",
      });
    },
    onError: (error) =>
      toast({
        title: "Could not update profile",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  const dirty = Object.keys(edits).length > 0;
  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate("save");
      }}
    >
      <fieldset disabled={mutation.isPending} className="space-y-6 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Your shared business details. Saving updates this profile and resets
            previous checks; it does not publish changes to directories yet.
            Google imports preserve fields you edited.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={!googleLinked || dirty || mutation.isPending}
            onClick={() => mutation.mutate("import")}
          >
            {mutation.isPending && mutation.variables === "import"
              ? "Importing…"
              : "Import from Google"}
          </Button>
        </div>
        {!googleLinked && (
          <p className="text-sm text-muted-foreground">
            Link this location to Google in Locations to import its details.
          </p>
        )}
        {!profile && (
          <p className="rounded-md bg-muted p-3 text-sm">
            No profile yet. Import from Google or enter the details you know and
            save.
          </p>
        )}
        <label className="block max-w-md text-sm font-medium">
          Service-area business
          <select
            aria-label="Service-area business"
            className={`${selectClass} mt-1`}
            value={
              value("service_area_only") == null
                ? ""
                : String(value("service_area_only"))
            }
            onChange={(event) =>
              change(
                "service_area_only",
                event.target.value === ""
                  ? null
                  : event.target.value === "true",
              )
            }
          >
            <option value="">Unknown</option>
            <option value="true">
              Yes — customers are served at their location
            </option>
            <option value="false">No — customers can visit my address</option>
          </select>
        </label>
        {value("service_area_only") === true && (
          <p className="text-sm text-muted-foreground">
            A street address is not required for matching. Only share an address
            you want listed; leave it empty if it is private.
          </p>
        )}
        {(owned.has("service_area_only") || "service_area_only" in edits) && (
          <p className="text-xs text-primary">
            Service-area setting:{" "}
            {"service_area_only" in edits ? "Unsaved edit" : "Owner edited"}
          </p>
        )}
        {groups.map((group) => (
          <fieldset key={group.title} className="space-y-4 border-t pt-4">
            <legend className="px-1 text-base font-semibold">
              {group.title}
            </legend>
            <div className="grid gap-4 md:grid-cols-2">
              {group.fields.map((field) => (
                <div
                  key={field.key}
                  className={
                    field.kind === "long" || field.kind === "structured"
                      ? "md:col-span-2"
                      : ""
                  }
                >
                  <label
                    htmlFor={`profile-${field.key}`}
                    className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium"
                  >
                    {field.title}
                    {(owned.has(field.key) || field.key in edits) && (
                      <span className="text-xs font-normal text-primary">
                        {field.key in edits ? "Unsaved edit" : "Owner edited"}
                      </span>
                    )}
                  </label>
                  {field.kind === "structured" ? (
                    <StructuredValue
                      title={field.title}
                      value={
                        value(field.key) ??
                        (["services", "service_areas"].includes(field.key)
                          ? []
                          : {})
                      }
                      onChange={(next) => change(field.key, next)}
                    />
                  ) : field.kind === "list" || field.kind === "long" ? (
                    <Textarea
                      id={`profile-${field.key}`}
                      rows={3}
                      value={
                        field.kind === "list"
                          ? ((value(field.key) as string[] | undefined)?.join(
                              "\n",
                            ) ?? "")
                          : String(value(field.key) ?? "")
                      }
                      onChange={(event) =>
                        change(
                          field.key,
                          field.kind === "list"
                            ? event.target.value
                              ? event.target.value.split("\n")
                              : null
                            : event.target.value || null,
                        )
                      }
                    />
                  ) : (
                    <Input
                      id={`profile-${field.key}`}
                      type={
                        field.kind === "url"
                          ? "url"
                          : field.kind === "number"
                            ? "number"
                            : "text"
                      }
                      min={field.kind === "number" ? 1000 : undefined}
                      max={field.kind === "number" ? 9999 : undefined}
                      value={String(value(field.key) ?? "")}
                      onChange={(event) =>
                        change(
                          field.key,
                          event.target.value
                            ? field.kind === "number"
                              ? Number(event.target.value)
                              : event.target.value
                            : null,
                        )
                      }
                    />
                  )}
                  {(field.hint || field.kind === "list") && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {field.hint ?? "One item per line."}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-background py-4">
          <Button type="submit" disabled={!dirty || mutation.isPending}>
            {mutation.isPending && mutation.variables === "save"
              ? "Saving…"
              : "Save business profile"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || mutation.isPending}
            onClick={() => setEdits({})}
          >
            Discard edits
          </Button>
          {dirty && (
            <span className="text-sm text-muted-foreground">
              Save or discard edits before importing from Google.
            </span>
          )}
        </div>
      </fieldset>
    </form>
  );
}
