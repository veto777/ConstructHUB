/**
 * lazy() for the app's code-split pages, aware of deploys (lib/stale-build.ts):
 * when a page's chunk cannot be loaded because a newer build replaced it, the
 * tab reloads once ("Updating to the latest version…") instead of going blank.
 * When a reload would not help (same build, offline, or it was just tried) the
 * page says so and offers a reload; only an unexplained failure is reported
 * to the issue desk.
 */
import { lazy, type ComponentType } from "react";
import { isChunkLoadError, recoverFromStaleBuild, type StaleBuildOutcome } from "./stale-build";
import { reportClientError } from "./report-client-errors";

function loadFailedNotice(outcome: StaleBuildOutcome): ComponentType {
  const offline = outcome === "offline";
  return function PageLoadFailed() {
    return (
      <div role="alert" data-testid="page-load-failed" className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-base font-medium">{offline ? "You appear to be offline" : "This page could not be loaded"}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {offline
            ? "We could not reach ConstructHUB to load this page. Check your connection, then reload."
            : "Part of the app did not load. Reloading usually fixes it; if it keeps happening, tell us which page."}
        </p>
        <button
          type="button"
          data-testid="button-reload-page"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  };
}

export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async (): Promise<{ default: T }> => {
    try {
      return await load();
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;
      const outcome = await recoverFromStaleBuild();
      // The page is being replaced: stay suspended under the "Updating…" notice.
      if (outcome === "reloading") return new Promise<never>(() => {});
      if (outcome !== "offline") reportClientError(err);
      return { default: loadFailedNotice(outcome) as unknown as T };
    }
  });
}
