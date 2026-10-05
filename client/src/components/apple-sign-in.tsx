import { inNativeApp } from "@/lib/app-shell";

/**
 * Sign in with Apple — only inside the ConstructHUB iPhone apps (App Store guideline 4.8: offered next to Google).
 * The button asks the app for Apple's native sheet (bridge message "appleSignIn", ios/Shared/BrowserController.swift);
 * the app posts Apple's token to /api/auth/apple (server/apple-auth.ts) from this page and then opens `next`
 * (or the 2FA step). Re-verification ("reauth") reports back with a `ch-apple-signin` window event.
 */
type Bridge = { postMessage: (message: unknown) => void };

export function appleBridge(): Bridge | null {
  if (typeof window === "undefined" || !inNativeApp()) return null;
  return ((window as any).webkit?.messageHandlers?.ch as Bridge | undefined) ?? null;
}

/** Confirm it's you with the Apple ID linked to this account; resolves on success, rejects when cancelled or refused. */
export function requestAppleReauth(): Promise<void> {
  const bridge = appleBridge();
  if (!bridge) return Promise.reject(new Error("Sign in with Apple is only available in the iPhone app."));
  return new Promise((resolve, reject) => {
    const done = (event: Event) => {
      const detail = (event as CustomEvent).detail ?? {};
      if (detail.purpose !== "reauth") return;
      window.removeEventListener("ch-apple-signin", done);
      if (detail.ok) resolve();
      else reject(new Error(detail.message || "Apple couldn't confirm it's you."));
    };
    window.addEventListener("ch-apple-signin", done);
    bridge.postMessage({ type: "appleSignIn", purpose: "reauth" });
  });
}

export function AppleMark({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 814 1000" className={className} fill="currentColor" aria-hidden="true">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  );
}

/** Apple's black button style, the same size as the Google button beside it. Renders nothing outside the app. */
export function AppleSignInButton({ label, next, testId }: { label: string; next?: string | null; testId: string }) {
  const bridge = appleBridge();
  if (!bridge) return null;
  return (
    <button
      type="button"
      onClick={() => bridge.postMessage({ type: "appleSignIn", purpose: "login", next: next ?? undefined })}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-black text-[15px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange focus-visible:ring-offset-2"
      data-testid={testId}
    >
      <AppleMark />
      {label}
    </button>
  );
}
