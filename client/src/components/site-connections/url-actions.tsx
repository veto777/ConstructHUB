import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GooglePill } from "@/components/google";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { urlBelongsToProperty } from "./context";
export type UrlRow = { assetId: string; url: string; selected: boolean };
/**
 * The review step before URL work is queued. Rendered inside a Radix portal: the action is a
 * shadcn `Button` (not a `GooglePill` — `.g-pill` reads `--g-accent` from `.g-surface`, which
 * does not reach a portal), and `DialogContent` re-supplies the surface tokens so the dialog
 * matches the page in light and dark (same fix as domains.tsx).
 */
export function ReviewDialog({
  review,
  picked,
  assets,
  busy,
  submit,
  close,
}: {
  review: "inspect" | "sitemap";
  picked: UrlRow[];
  assets: any[];
  busy: boolean;
  submit: (body: any) => Promise<any>;
  close: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="g-surface max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {review === "sitemap" ? "Submit sitemaps" : "Queue URL inspections"}
          </DialogTitle>
          <DialogDescription>
            Review the property and URL for each selected row. Sitemaps require
            Full access.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-3">
          {picked.map((r, i) => (
            <li key={i} className="break-all text-sm">
              <b>{assets.find((a) => String(a.id) === r.assetId)?.name}</b>
              <p>{r.url}</p>
            </li>
          ))}
        </ul>
        <Button
          disabled={busy}
          onClick={async () => {
            const result = await submit({
              kind: review,
              confirm: review === "sitemap",
              items: picked.map((r) => ({
                assetId: Number(r.assetId),
                url: r.url,
              })),
            });
            if (result) close();
          }}
          data-testid="button-confirm-queue"
        >
          Confirm and queue
        </Button>
      </DialogContent>
    </Dialog>
  );
}
export function UrlActions({
  assets,
  busy,
  submit,
}: {
  assets: any[];
  busy: boolean;
  submit: (body: any) => Promise<any>;
}) {
  const [rows, setRows] = useState<UrlRow[]>([
    { assetId: String(assets[0]?.id ?? ""), url: "", selected: true },
  ]);
  const [review, setReview] = useState<"inspect" | "sitemap" | null>(null);
  const picked = rows.filter((r) => r.selected);
  const valid = (r: UrlRow) => {
    const a = assets.find((a) => String(a.id) === r.assetId);
    return !!a && urlBelongsToProperty(a.external_id, r.url);
  };
  const change = (i: number, patch: Partial<UrlRow>) =>
    setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <section className="space-y-3">
      <h3 className="font-medium">Sitemaps and URL inspections</h3>
      <p className="text-sm text-muted-foreground">
        Choose a property and enter each URL. Select the rows to submit.
        Inspection checks status; it does not request indexing.
      </p>
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[auto_1fr_2fr_auto] sm:items-center"
        >
          <input
            type="checkbox"
            aria-label={`Select URL row ${i + 1}`}
            checked={r.selected}
            onChange={(e) => change(i, { selected: e.target.checked })}
          />
          <label className="text-sm">
            Property
            <select
              className="block h-10 w-full rounded border bg-background px-2"
              value={r.assetId}
              onChange={(e) => change(i, { assetId: e.target.value })}
            >
              <option value="">Choose property</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            URL
            <Input
              value={r.url}
              placeholder="https://your-site.com/sitemap.xml"
              onChange={(e) => change(i, { url: e.target.value })}
              aria-invalid={!!r.url && !valid(r)}
            />
            {r.url && !valid(r) && (
              <span className="text-destructive">
                Enter a URL within the selected property.
              </span>
            )}
          </label>
          <GooglePill
            label={`Remove row ${i + 1}`}
            onClick={() => setRows(rows.filter((_, n) => n !== i))}
          />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <GooglePill
          label="Add URL"
          disabled={rows.length >= 100}
          onClick={() =>
            setRows([
              ...rows,
              { assetId: String(assets[0]?.id ?? ""), url: "", selected: true },
            ])
          }
        />
        {(["inspect", "sitemap"] as const).map((kind) => (
          <GooglePill
            key={kind}
            label={
              kind === "inspect" ? "Review inspections" : "Review sitemaps"
            }
            disabled={
              busy ||
              !picked.length ||
              picked.some((r) => !valid(r)) ||
              (kind === "sitemap" &&
                picked.some(
                  (r) =>
                    assets.find((a) => String(a.id) === r.assetId)?.status ===
                    "siteRestrictedUser",
                ))
            }
            onClick={() => setReview(kind)}
          />
        ))}
      </div>
      {review && (
        <ReviewDialog
          review={review}
          picked={picked}
          assets={assets}
          busy={busy}
          submit={submit}
          close={() => {
            setReview(null);
            setRows(rows.filter((r) => !r.selected));
          }}
        />
      )}
    </section>
  );
}
