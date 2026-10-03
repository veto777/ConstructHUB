import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { useCart } from "@/contexts/cart-context";
import { TalkToSalesButton } from "@/components/talk-to-sales";
import { formatUsd } from "@/lib/pricing-display";
import { SALES_THRESHOLD_CENTS } from "@shared/plans";
import { ShoppingCart, X, Loader2, Package, ArrowRight, Trash2, MessageSquare } from "lucide-react";
import { useState, useEffect } from "react";

export function CartSheet() {
  const { items, removeItem, clearCart, getTotal, getItemCount, salesItems, dismissSalesItem } = useCart();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  const params = new URLSearchParams(window.location.search);
  const cartSuccess = params.get("cart_success");
  const cartCanceled = params.get("cart_canceled");

  useEffect(() => {
    if (cartSuccess) {
      clearCart();
      toast({ title: "Purchase successful!", description: "Your items have been purchased. Check your email for confirmation." });
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (cartCanceled) {
      toast({ title: "Checkout canceled", description: "No charges were made. Your cart items are still saved." });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [cartSuccess, cartCanceled]);

  // Only items under the sales threshold are ever in `items`; anything at or
  // above it is a sales request (salesItems), never a checkout line.
  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/create-cart-checkout", { items });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (err: any) => {
      if (err.message?.includes("Login required") || err.message?.includes("401")) {
        toast({ title: "Sign in required", description: "Please sign in to complete your purchase.", variant: "destructive" });
        setOpen(false);
        setLocation("/auth");
      } else {
        toast({ title: "Checkout failed", description: apiErrorMessage(err), variant: "destructive" });
      }
    },
  });

  const isDev = import.meta.env.DEV;
  const handleCheckout = () => {
    if (!user && !isDev) {
      setOpen(false);
      setLocation("/auth");
      return;
    }
    checkoutMutation.mutate();
  };

  const itemCount = getItemCount();
  const total = getTotal();
  const isProcessing = checkoutMutation.isPending;
  // A failed attempt's message stays until the cart changes or the sheet is
  // reopened — never while a request is still running.
  const clearCartError = () => {
    if (checkoutMutation.isError) checkoutMutation.reset();
  };
  const empty = items.length === 0 && salesItems.length === 0;

  return (
    <Sheet open={open} onOpenChange={(next) => { if (next) clearCartError(); setOpen(next); }}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Cart" data-testid="button-cart-trigger">
          <ShoppingCart className="h-5 w-5" />
          {itemCount + salesItems.length > 0 && (
            <Badge
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px] bg-primary text-primary-foreground border-none"
              data-testid="badge-cart-count"
            >
              {itemCount + salesItems.length}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col" data-testid="sheet-cart">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2" data-testid="text-cart-title">
            <ShoppingCart className="h-5 w-5" />
            Shopping Cart
            {itemCount > 0 && (
              <Badge variant="secondary" className="ml-1">{itemCount} {itemCount === 1 ? "item" : "items"}</Badge>
            )}
          </SheetTitle>
        </SheetHeader>

        {empty ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-12 space-y-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-lg" data-testid="text-cart-empty">Your cart is empty</p>
              <p className="text-sm text-muted-foreground mt-1">
                Browse our Master Class or Done-For-You services to get started.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setOpen(false); setLocation("/master-class"); }} data-testid="link-browse-courses">
                Master Class
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setOpen(false); setLocation("/pricing#services"); }} data-testid="link-browse-services">
                Services
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto space-y-3 py-4">
              {salesItems.length > 0 && (
                <div className="space-y-2 rounded-lg border border-border bg-card p-3" data-testid="section-cart-sales">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" /> Talk to a sales rep
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Anything {formatUsd(SALES_THRESHOLD_CENTS)} or more is priced with a sales rep, so it can't be checked out here.
                  </p>
                  {salesItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-md border border-border/50 bg-background p-2" data-testid={`card-cart-sales-${item.id}`}>
                      <p className="flex-1 min-w-0 text-sm font-medium truncate">{item.name}</p>
                      <TalkToSalesButton topic={item.name} onSent={() => dismissSalesItem(item.id)} size="sm" variant="outline" className="shrink-0 h-8" data-testid={`button-cart-sales-${item.id}`}>
                        Talk to sales
                      </TalkToSalesButton>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0 text-muted-foreground"
                        aria-label={`Dismiss ${item.name}`}
                        onClick={() => dismissSalesItem(item.id)}
                        data-testid={`button-dismiss-sales-${item.id}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/30"
                  data-testid={`card-cart-item-${item.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate" data-testid={`text-cart-item-name-${item.id}`}>{item.name}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {item.type === "course_module" ? "Course module" :
                         item.type === "course_bundle" ? "Course bundle" :
                         item.type === "dfy_bundle" ? "Service bundle" : "Service"}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold text-sm" data-testid={`text-cart-item-price-${item.id}`}>
                      {formatUsd(item.price)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => { clearCartError(); removeItem(item.id); }}
                      data-testid={`button-remove-cart-item-${item.id}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t pt-4 space-y-3">
              {items.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Subtotal</span>
                    <span className="text-xl font-extrabold" data-testid="text-cart-total">
                      {formatUsd(total)}
                    </span>
                  </div>

                  {checkoutMutation.error && (
                    <p role="alert" className="text-sm text-destructive" data-testid="text-cart-error">
                      {apiErrorMessage(checkoutMutation.error)}
                    </p>
                  )}

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleCheckout}
                    disabled={isProcessing}
                    data-testid="button-cart-checkout"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Processing...
                      </>
                    ) : (
                      <>
                        Proceed to checkout
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                </>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => { clearCartError(); clearCart(); salesItems.forEach(i => dismissSalesItem(i.id)); }}
                data-testid="button-clear-cart"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Clear cart
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
