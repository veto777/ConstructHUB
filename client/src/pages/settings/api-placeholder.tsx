import { KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiErrorMessage } from "@/lib/queryClient";
import { LoadingCard, formatCount, formatDate, useOptionalQuery } from "./shared";
import type { SettingsSectionProps } from "./types";

/**
 * Workspace → API keys / API usage — the default panels. They read the
 * account API endpoints when the server has them and say so when it doesn't.
 * The full key management console (create with step-up, rename, limits,
 * revoke) and the usage charts register over these through sections.tsx.
 */

type ApiKeyItem = {
  id: string; name: string; prefix: string; suffix: string; scopes: string[];
  monthlyUnitLimit: number | null; unitsThisMonth: number; createdAt: string; lastUsedAt: string | null; expiresAt: string | null;
};
type ApiKeysResponse = {
  keys: ApiKeyItem[];
  plan: { apiEnabled: boolean; unitsPerMonth: number; usedThisMonth: number; ratePerMinute: number };
};
type ApiUsageResponse = {
  days: { date: string; units: number; requests: number; byKey: Record<string, number> }[];
  totals: { units: number; requests: number };
};

function Unavailable({ title, testId }: { title: string; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>The account API isn't installed on this server yet. When it is, this page is where it lives:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Keys scoped to <strong>read</strong> or <strong>write</strong>, shown once when created and revocable any time.</li>
          <li>A monthly allowance of API units by plan, a per-key limit you set, and 60 requests a minute per key.</li>
          <li>Your data only — posts, replies and social posts you send through the API are stored exactly as you supplied them. AI features (TruthCoder drafting, AI replies, Site Scan analysis) are never available through the API.</li>
        </ul>
      </CardContent>
    </Card>
  );
}

export function ApiKeysSection(_props: SettingsSectionProps) {
  const { data, error, isLoading } = useOptionalQuery<ApiKeysResponse>("/api/account/api-keys");
  if (isLoading) return <LoadingCard label="Loading API keys…" />;
  if (error) {
    return <Card><CardContent className="py-6 text-sm text-destructive" role="alert" data-testid="text-api-keys-error">Couldn't load API keys. {apiErrorMessage(error)}</CardContent></Card>;
  }
  if (data === null || !data) return <Unavailable title="API keys" testId="card-api-keys-unavailable" />;

  const { keys, plan } = data;
  return (
    <div className="space-y-6" data-testid="section-api-keys">
      <Card data-testid="card-api-plan">
        <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold flex items-center gap-2">
              API access
              <Badge variant="outline" className="text-[10px]" data-testid="badge-api-enabled">{plan.apiEnabled ? "Enabled" : "Not in your plan"}</Badge>
            </p>
            <p className="text-xs text-muted-foreground" data-testid="text-api-plan-units">
              {plan.apiEnabled
                ? `${formatCount(plan.usedThisMonth)} of ${formatCount(plan.unitsPerMonth)} units used this month · ${formatCount(plan.ratePerMinute)} requests / min per key`
                : "Your plan doesn't include API units. Upgrade in Pricing to use the API."}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card data-testid="card-api-keys">
        <CardHeader>
          <CardTitle className="text-lg">Keys</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {keys.length === 0 ? (
            <div className="text-center py-10 px-4" data-testid="text-api-keys-empty">
              <KeyRound className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">No API keys yet</p>
            </div>
          ) : (
            <ul className="divide-y">
              {keys.map((k) => (
                <li key={k.id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] px-4 py-3 text-sm" data-testid={`row-api-key-${k.id}`}>
                  <div className="min-w-0">
                    <p className="font-medium">{k.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">chub_{k.prefix}_…{k.suffix}</p>
                    <p className="text-xs text-muted-foreground">
                      {k.scopes.join(", ")} · created {formatDate(k.createdAt)} · last used {k.lastUsedAt ? formatDate(k.lastUsedAt) : "never"}{k.expiresAt ? ` · expires ${formatDate(k.expiresAt)}` : ""}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums sm:text-right">
                    {formatCount(k.unitsThisMonth)}{k.monthlyUnitLimit != null ? ` of ${formatCount(k.monthlyUnitLimit)}` : ""} units this month
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ApiUsageSection(_props: SettingsSectionProps) {
  const { data, error, isLoading } = useOptionalQuery<ApiUsageResponse>("/api/account/api-usage?days=30");
  if (isLoading) return <LoadingCard label="Loading API usage…" />;
  if (error) {
    return <Card><CardContent className="py-6 text-sm text-destructive" role="alert" data-testid="text-api-usage-error">Couldn't load API usage. {apiErrorMessage(error)}</CardContent></Card>;
  }
  if (data === null || !data) return <Unavailable title="API usage" testId="card-api-usage-unavailable" />;

  const days = [...(data.days ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div className="space-y-6" data-testid="section-api-usage">
      <Card data-testid="card-api-usage-totals">
        <CardContent className="pt-6 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Units, last 30 days</p>
            <p className="text-2xl font-semibold tabular-nums" data-testid="text-api-usage-units">{formatCount(data.totals?.units ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Requests, last 30 days</p>
            <p className="text-2xl font-semibold tabular-nums" data-testid="text-api-usage-requests">{formatCount(data.totals?.requests ?? 0)}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">By day</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {days.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground" data-testid="text-api-usage-empty">No API calls in the last 30 days.</p>
          ) : (
            <ul className="divide-y">
              {days.map((d) => (
                <li key={d.date} className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2 text-sm tabular-nums" data-testid={`row-api-usage-${d.date}`}>
                  <span>{d.date}</span>
                  <span className="text-muted-foreground">{formatCount(d.requests)} req</span>
                  <span>{formatCount(d.units)} units</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
