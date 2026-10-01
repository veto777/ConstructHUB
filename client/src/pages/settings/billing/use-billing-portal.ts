import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

/**
 * Stripe's hosted billing portal (cards, invoices, cancellation). The server
 * creates a one-time session (POST /api/stripe/create-portal) and the browser
 * follows its URL; nothing about the card is handled here.
 */
export function useBillingPortal() {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/stripe/create-portal", {})).json(),
    onSuccess: (data: any) => { if (data?.url) window.location.href = data.url; },
    onError: (err) => toast({ title: "Couldn't open billing", description: apiErrorMessage(err), variant: "destructive" }),
  });
  return { open: () => mutation.mutate(), isPending: mutation.isPending };
}
