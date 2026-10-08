/**
 * What one budgeted call (withBudget, server/seo/budget.ts) learns about its own cost while it runs. The data source
 * reports a cost on every task it answers; a task answered WITHOUT a numeric cost is a cost we do not know — never a
 * free one. The vendor client (server/seo/dataforseo.ts `request`) marks it here, so every lookup inside the call is
 * covered without each caller having to carry the flag, and the ledger then keeps the estimate instead of zero.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type CallCost = { unknown: boolean };
const current = new AsyncLocalStorage<CallCost>();

/** Runs `fn` as one budgeted call; `state.unknown` is true afterwards if any answer inside came without a cost. */
export function withCallCost<T>(state: CallCost, fn: () => Promise<T>): Promise<T> {
  return current.run(state, fn);
}

/** An answer came without a numeric cost: the call's cost is not known. Outside a budgeted call this does nothing. */
export function markCostUnknown(): void {
  const s = current.getStore();
  if (s) s.unknown = true;
}
