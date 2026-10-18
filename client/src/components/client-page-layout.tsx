/**
 * The client page's containers in the account's order (shared/client-page-layout.ts).
 *
 *   useClientPageLayout(me)  the stored order/hidden set from /api/crm/me (org.customFields.clientPageLayout)
 *   <ClientSections>         the flex column the containers sit in (CSS order, so the markup never moves)
 *   <ClientSection id>       one container: hidden → nothing; for owners/admins a small × in the corner, shown on
 *                            hover, that asks before removing the container from every client page
 *   <ClientPageLayoutCard>   Settings → Client page: arrange, show/hide, reset
 */
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutList, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SectionTitle } from "@/components/crm-ui";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CLIENT_SECTIONS, DEFAULT_CLIENT_PAGE_LAYOUT, normalizeClientPageLayout, sectionLabel,
  type ClientPageLayout, type ClientSectionKey,
} from "@shared/client-page-layout";

export type ClientLayoutState = ClientPageLayout & { canEdit: boolean };

export function useClientPageLayout(me: any): ClientLayoutState {
  const layout = normalizeClientPageLayout(me?.org?.customFields?.clientPageLayout);
  return { ...layout, canEdit: me?.permissions?.manageSettings === true };
}

function useSaveLayout(okTitle: string) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (layout: ClientPageLayout) => (await apiRequest("PATCH", "/api/crm/org", { clientPageLayout: layout })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      toast({ title: okTitle });
    },
    onError: (e) => toast({ title: "Could not save the layout", description: apiErrorMessage(e), variant: "destructive" }),
  });
}

export function ClientSections({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6" data-testid="client-sections">{children}</div>;
}

export function ClientSection({ id, layout, when = true, children }: {
  id: ClientSectionKey; layout: ClientLayoutState; when?: boolean; children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const save = useSaveLayout(`${sectionLabel(id)} removed from client pages`);
  if (!when || layout.hidden.includes(id)) return null;
  const order = layout.order.indexOf(id);
  return (
    <div className="group relative" style={{ order: order < 0 ? 99 : order }} data-testid={`client-section-${id}`}>
      {children}
      {layout.canEdit && (
        <>
          {/* Visible only while the mouse is over the container (always on touch screens, where there is no hover). */}
          <button type="button" onClick={() => setConfirming(true)} aria-label={`Remove the ${sectionLabel(id)} container`}
            title={`Remove ${sectionLabel(id)} from client pages`}
            className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border bg-background/90 text-muted-foreground shadow-sm transition-opacity hover:bg-destructive hover:text-destructive-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"
            data-testid={`button-remove-section-${id}`}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogContent data-testid={`dialog-remove-section-${id}`}>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove the {sectionLabel(id)} container?</AlertDialogTitle>
                <AlertDialogDescription>
                  It comes off every client page for the whole account. Nothing is deleted — the data stays, and you can
                  bring the container back any time in Settings → Client page.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction data-testid={`button-remove-section-confirm-${id}`}
                  onClick={() => save.mutate({ order: layout.order, hidden: [...layout.hidden, id] })}>
                  Remove container
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

/** Settings → Client page: the containers in order, with move up/down, show/hide, Save and Reset. */
export function ClientPageLayoutCard() {
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const stored = useClientPageLayout(me);
  const [draft, setDraft] = useState<ClientPageLayout>({ order: stored.order, hidden: stored.hidden });
  useEffect(() => { setDraft({ order: stored.order, hidden: stored.hidden }); }, [JSON.stringify(stored.order), JSON.stringify(stored.hidden)]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSaveLayout("Client page layout saved");
  const dirty = JSON.stringify(draft) !== JSON.stringify({ order: stored.order, hidden: stored.hidden });
  const move = (i: number, d: -1 | 1) => setDraft((cur) => {
    const order = [...cur.order];
    const j = i + d;
    if (j < 0 || j >= order.length) return cur;
    [order[i], order[j]] = [order[j], order[i]];
    return { ...cur, order };
  });
  const toggle = (k: ClientSectionKey) => setDraft((cur) => ({ ...cur, hidden: cur.hidden.includes(k) ? cur.hidden.filter((x) => x !== k) : [...cur.hidden, k] }));
  return (
    <Card data-testid="card-client-page-layout">
      <CardHeader>
        <SectionTitle icon={LayoutList} title="Client page"
          description="The order the containers appear in on every client's page, and which ones show. Identity, Job stage and Quick actions always stay at the top." />
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="divide-y rounded-lg border" data-testid="list-client-sections">
          {draft.order.map((k, i) => {
            const hidden = draft.hidden.includes(k);
            return (
              <li key={k} className={`flex items-center gap-2 px-3 py-2 ${hidden ? "text-muted-foreground" : ""}`} data-testid={`layout-row-${k}`}>
                <span className="w-6 text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
                <span className={`min-w-0 flex-1 truncate text-sm ${hidden ? "line-through" : "font-medium"}`}>{sectionLabel(k)}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${sectionLabel(k)} up`} data-testid={`button-layout-up-${k}`}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(i, 1)} disabled={i === draft.order.length - 1} aria-label={`Move ${sectionLabel(k)} down`} data-testid={`button-layout-down-${k}`}><ArrowDown className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => toggle(k)} data-testid={`button-layout-toggle-${k}`}>
                  {hidden ? <><Eye className="mr-1 h-3.5 w-3.5" />Show</> : <><EyeOff className="mr-1 h-3.5 w-3.5" />Hide</>}
                </Button>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending} data-testid="button-layout-save">
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save layout
          </Button>
          <Button variant="ghost" onClick={() => setDraft({ ...DEFAULT_CLIENT_PAGE_LAYOUT })} data-testid="button-layout-reset">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reset to default
          </Button>
          <span className="text-xs text-muted-foreground">{CLIENT_SECTIONS.length - draft.hidden.length} of {CLIENT_SECTIONS.length} containers shown</span>
        </div>
      </CardContent>
    </Card>
  );
}
