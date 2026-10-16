import { Button } from '@/components/ui/button';
import { BrandIcon } from '@/components/brand-icon';
import { connectionAction, lastSyncText, type GoogleConnection } from '@shared/gbp-connection';
import { GoogleConnectionPill, useGoogleConnection } from '@/components/gbp-connection';

/** What each tool does through the linked profile — the only line that differs between the four pages. */
const WHY = {
  posts: 'Posts are published to Google through the linked profile.',
  photos: 'Photos are uploaded to Google through the linked profile.',
  'listing-editor': 'Edits are saved to Google through the linked profile.',
  monitor: 'The monitor checks that listing’s public Google data for changes.',
} as const;

export type GbpPrerequisiteTool = keyof typeof WHY;

/**
 * The Google prerequisite, asked the same way on Posts, Photos, Listing editor and GMB Edit Monitor
 * (review w2-agent10 #15): "Link a Google Business Profile first", the true state from the one connection
 * truth (shared/gbp-connection.ts), and exactly one action. Renders nothing once the prerequisite is met.
 *
 * `action` overrides the computed step (the monitor adds a listing to watch, which needs no Google sign-in);
 * `met` lets the page say the prerequisite is already satisfied.
 */
export function GbpPrerequisite({ tool, action, met, detail }: {
  tool: GbpPrerequisiteTool;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  met?: boolean;
  detail?: string;
}) {
  const { data: connection, isLoading, error } = useGoogleConnection();
  const ready = met ?? (connection ? connection.counts.connected > 0 : false);
  if (ready) return null;
  if (!action && (isLoading || error || !connection)) return null;
  const step = action ? null : connectionAction(connection as GoogleConnection);
  return (
    <section className="rounded-xl border bg-card p-4 space-y-2 text-sm" data-testid="gbp-prerequisite" data-tool={tool}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Link a Google Business Profile first</h2>
        {connection && !action && <GoogleConnectionPill state={connection.state} />}
      </div>
      <p className="text-muted-foreground">
        {detail ?? connection?.detail} {WHY[tool]}
        {connection?.lastSync && !action ? ` ${lastSyncText(connection.lastSync)}.` : ''}
      </p>
      {action
        ? <Button onClick={action.onClick} disabled={action.disabled} data-testid="button-gbp-prerequisite">{action.label}</Button>
        : step && <Button asChild data-testid="button-gbp-prerequisite">
            <a href={step.href}>{step.href.startsWith('/api/gbp/connect') && <BrandIcon brand="google" className="h-4 w-4" />}{step.label}</a>
          </Button>}
    </section>
  );
}
