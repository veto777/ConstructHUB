import { useState } from "react";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inNativeApp } from "@/lib/app-shell";

/**
 * Inside the iPhone apps only: "Turn on" asks iOS for notification permission through the native bridge
 * (ios/Shared/BrowserController.swift, message "enablePush"); the app then registers this phone with
 * /api/app/push-token and server/apns.ts sends each in-app alert to it. The in-app switches decide which alerts,
 * so this card sits above them. Hidden in a browser (no bridge) — including ?app=1 testing.
 */
export function AppPushCard() {
  const [asked, setAsked] = useState(false);
  const bridge = typeof window !== "undefined" ? (window as any).webkit?.messageHandlers?.ch : null;
  if (!inNativeApp() || !bridge) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border p-4" data-testid="card-app-push">
      <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">Notifications on this iPhone</p>
        <p className="text-sm text-muted-foreground">
          {asked
            ? "If you chose Allow, your in-app alerts now arrive on this iPhone too. You can change it any time in iPhone Settings."
            : "Get your in-app alerts as phone notifications. The in-app switches decide which ones."}
        </p>
      </div>
      {!asked && (
        <Button size="sm" onClick={() => { bridge.postMessage({ type: "enablePush" }); setAsked(true); }} data-testid="button-app-push">
          Turn on
        </Button>
      )}
    </div>
  );
}
