/**
 * INFO_CONTENT (lib/info-content.ts, ~50 KB of ⓘ dialog text) loads on demand, for the same reason as
 * use-help-entry.ts: the CRM ribbon and app chrome mount InfoTips on pages a visitor from an ad never
 * opens, yet every visitor downloaded the text. The ⓘ appears once the text is in; afterwards it is immediate.
 */
import { useEffect, useState } from "react";

type InfoModule = typeof import("@/lib/info-content");
type InfoEntry = InfoModule["INFO_CONTENT"][string];
let content: InfoModule["INFO_CONTENT"] | undefined;
let loading: Promise<InfoModule> | undefined;

export function useInfoContent(key: string): InfoEntry | undefined {
  const [entry, setEntry] = useState<InfoEntry | undefined>(() => content?.[key]);
  useEffect(() => {
    let on = true;
    (loading ??= import("@/lib/info-content").then((m) => (content = m.INFO_CONTENT, m)))
      .then((m) => { if (on) setEntry(m.INFO_CONTENT[key]); });
    return () => { on = false; };
  }, [key]);
  return entry;
}
