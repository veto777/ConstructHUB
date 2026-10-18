/**
 * The client portal's view of the punch list & final walkthrough (shared/punch-list.ts): each scope's notes, which
 * are done, whether the walkthrough is complete, and the punch-list photos the crew tagged for that scope. Read-only —
 * the crew keeps it from the CRM client page.
 */
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { SectionTitle } from "@/components/crm-ui";
import { PhotoViewer } from "@/components/photo-viewer";
import { parsePunchPhotoName, type PunchScope } from "@shared/punch-list";
import { CheckCircle2, Circle, ClipboardCheck, Image as ImageIcon } from "lucide-react";

type PortalPunchList = { projectId: string; projectName: string; customerId: string; status: string; scopes: PunchScope[] };
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);

export function PortalPunchLists({ lists, photos }: { lists: PortalPunchList[]; photos: any[] }) {
  const [viewing, setViewing] = useState<{ list: number; items: any[]; index: number } | null>(null);
  if (!lists?.length) return null;
  return (
    <section className="space-y-3" data-testid="section-portal-punch-list">
      <SectionTitle icon={ClipboardCheck} title="Punch list & final walkthrough"
        description="The last details on your job, by scope, and the walkthrough that signs each one off." />
      {lists.map((l, li) => {
        const punchPhotos = (photos ?? []).filter((p: any) => p.customerId === l.customerId && parsePunchPhotoName(String(p.fileName ?? "")));
        const done = l.scopes.filter((s) => s.walkthroughDoneAt).length;
        return (
          <Card key={l.projectId} data-testid={`portal-punch-${l.projectId}`}>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{l.projectName}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${done === l.scopes.length ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                  {done} of {l.scopes.length} walkthrough{l.scopes.length === 1 ? "" : "s"} complete
                </span>
              </div>
              {l.scopes.map((s) => {
                const mine = punchPhotos.filter((p: any) => parsePunchPhotoName(String(p.fileName ?? ""))?.scope === s.scope);
                return (
                  <div key={s.scope} className="rounded-lg border p-3" data-testid={`portal-punch-scope-${s.scope}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{s.label}</p>
                      {s.walkthroughDoneAt
                        ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Walkthrough complete · {day(s.walkthroughDoneAt)}</span>
                        : <span className="text-xs text-muted-foreground">Walkthrough pending</span>}
                    </div>
                    {s.items.length ? (
                      <ul className="mt-2 space-y-1 text-sm">
                        {s.items.map((it) => (
                          <li key={it.id} className={`flex items-start gap-2 ${it.doneAt ? "text-muted-foreground line-through" : ""}`}>
                            {it.doneAt ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
                            <span>{it.text}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="mt-1 text-xs text-muted-foreground">No punch-list notes for this scope.</p>}
                    {mine.length > 0 && (
                      <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
                        {mine.map((p: any, i: number) => (
                          <button type="button" key={p.id} onClick={() => setViewing({ list: li, items: mine, index: i })} data-testid={`portal-punch-photo-${p.id}`}
                            className="block w-full overflow-hidden rounded-lg border bg-muted/30 transition-colors hover:border-primary/40">
                            {String(p.mime).startsWith("image/") && !/hei[cf]/.test(p.mime)
                              ? <img src={`${p.downloadUrl}?inline=1`} alt={parsePunchPhotoName(p.fileName)?.displayName ?? p.fileName} className="h-16 w-full object-cover" />
                              : <div className="flex h-16 items-center justify-center"><ImageIcon className="h-5 w-5 text-muted-foreground" /></div>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
      {viewing && (
        <PhotoViewer index={viewing.index} onIndex={(i) => setViewing({ ...viewing, index: i })} onClose={() => setViewing(null)}
          photos={viewing.items.map((p: any) => ({ id: p.id, name: parsePunchPhotoName(p.fileName)?.displayName ?? p.fileName, downloadUrl: p.downloadUrl, label: "Punch list",
            src: String(p.mime).startsWith("image/") && !/hei[cf]/.test(p.mime) ? `${p.downloadUrl}?inline=1` : null }))} />
      )}
    </section>
  );
}
