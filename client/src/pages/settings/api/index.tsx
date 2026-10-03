import { AppTabsList } from "@/components/app-ui";
/**
 * API panels (Settings → API keys, Settings → API usage). Each is a standalone
 * component that reads its own endpoints; `ApiPanel` composes them behind
 * tabs and `ApiSettingsPage` wraps that in a page for the /settings/api route.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlParam } from "@/hooks/use-url-param";
import { ApiKeysPanel, API_NO_AI_NOTICE, type ApiKeysPanelProps } from "./api-keys-panel";
import { ApiUsagePanel, type ApiUsagePanelProps } from "./api-usage-panel";

export { ApiKeysPanel, ApiUsagePanel, API_NO_AI_NOTICE };
export type { ApiKeysPanelProps, ApiUsagePanelProps };
export * from "./types";

export type ApiTab = "keys" | "usage";
export const API_TABS: readonly { id: ApiTab; label: string }[] = [
  { id: "keys", label: "API keys" },
  { id: "usage", label: "API usage" },
];
const isApiTab = (v: unknown): v is ApiTab => API_TABS.some((t) => t.id === v);

export type ApiPanelProps = {
  /** Controlled tab; when omitted the open tab lives in ?api= so a reload or shared link reopens it. */
  tab?: ApiTab;
  onTabChange?: (tab: ApiTab) => void;
  keys?: ApiKeysPanelProps;
  usage?: ApiUsagePanelProps;
};

export function ApiPanel({ tab, onTabChange, keys, usage }: ApiPanelProps = {}) {
  const [param, setParam] = useUrlParam("api");
  const active: ApiTab = tab ?? (isApiTab(param) ? param : "keys");
  const change = (next: string) => {
    if (!isApiTab(next)) return;
    onTabChange?.(next);
    if (tab === undefined) setParam(next === "keys" ? null : next);
  };
  return (
    <Tabs value={active} onValueChange={change} className="space-y-4" data-testid="tabs-api">
      <AppTabsList>
        {API_TABS.map((t) => (
          <TabsTrigger
            key={t.id}
            value={t.id}
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 py-2"
            data-testid={`tab-api-${t.id}`}
          >
            {t.label}
          </TabsTrigger>
        ))}
      </AppTabsList>
      <TabsContent value="keys" className="mt-0"><ApiKeysPanel {...keys} /></TabsContent>
      <TabsContent value="usage" className="mt-0"><ApiUsagePanel {...usage} /></TabsContent>
    </Tabs>
  );
}

/** The /settings/api page: a heading and the tabbed panels. */
export default function ApiSettingsPage() {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-api-title">API</h1>
          <p className="text-sm text-muted-foreground mt-1">Keys for reading your data from your own tools, and what they've used.</p>
        </div>
        <ApiPanel />
      </div>
    </div>
  );
}
