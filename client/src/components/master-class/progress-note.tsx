import type { Checklist } from "@/components/guides/progress";
import { Button } from "@/components/ui/button";

/** Recovery sits beside every Master Class progress disclosure. */
export function ProgressNote({ list }: { list: Checklist }) {
  return <span className="inline-flex flex-wrap items-center gap-2">
    <span role="status">{list.note}</span>
    {list.accountError && <Button type="button" variant="outline" size="sm" disabled={list.checkingAccount}
      onClick={list.checkAccount} className="focus-visible:ring-2 focus-visible:ring-ring">
      {list.checkingAccount ? "Checking account…" : "Check account"}
    </Button>}
  </span>;
}
