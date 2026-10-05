import { Link } from "wouter"
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { planPromptFor, type PlanPrompt } from "@/lib/plan-errors"
import { inNativeApp } from "@/lib/app-shell"
import { isPortal, marketingUrl } from "@/lib/site"

/** "See Pro" / "Add extra seat" / "Manage billing" next to a toast that shows a plan answer. */
function PlanPromptAction({ prompt }: { prompt: PlanPrompt }) {
  // Plans and billing live on the main site; the CRM portal host has no /pricing route.
  return (
    <ToastAction altText={prompt.label} asChild>
      {isPortal() ? (
        <a href={marketingUrl(prompt.href)} data-testid="link-toast-plan-prompt">{prompt.label}</a>
      ) : (
        <Link href={prompt.href} data-testid="link-toast-plan-prompt">{prompt.label}</Link>
      )}
    </ToastAction>
  )
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        // The iPhone apps sell nothing (App Store 3.1.3(f)): no "See Pro" / "Add seat" / "Manage billing" toast links.
        const prompt = action || inNativeApp() ? null : planPromptFor(description)
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action ?? (prompt && <PlanPromptAction prompt={prompt} />)}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
