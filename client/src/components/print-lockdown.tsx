import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/hooks/use-toast";

/*
 * Print/PDF lockdown for the public document pages (estimate, invoice, client
 * portal). Two layers:
 *   1. @media print CSS hides the app (#root) and shows only the notice, so
 *      the printed/PDF'd page carries no document content.
 *   2. A beforeprint handler fires the same notice as a toast the moment the
 *      user opens the print dialog.
 *
 * HONEST SCOPE: this is a deterrent, not a guarantee. CSS and DOM tricks
 * cannot stop screenshots, photos of the screen, or a determined user
 * editing the page. Never describe this to users as "preventing" copies.
 */

const NOTICE =
  "Printing is disabled for this document — contact us for a copy.";

export function PrintLockdown(): JSX.Element {
  const { toast } = useToast();

  useEffect(() => {
    const onBeforePrint = () => {
      document.body.classList.add("print-lockdown");
      toast({ title: "Printing is disabled", description: "Contact us for a copy of this document." });
    };
    const onAfterPrint = () => document.body.classList.remove("print-lockdown");
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [toast]);

  return (
    <>
      <style>{`
        .print-lockdown-notice { display: none; }
        @media print {
          body > *:not(.print-lockdown-notice) { display: none !important; }
          .print-lockdown-notice {
            display: block !important;
            padding: 3rem 2rem;
            font: 16px/1.6 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
            text-align: center;
            color: #111;
          }
        }
      `}</style>
      {createPortal(
        <div className="print-lockdown-notice" data-testid="print-lockdown-notice">
          {NOTICE}
        </div>,
        document.body,
      )}
    </>
  );
}
