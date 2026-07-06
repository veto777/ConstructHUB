import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useCart } from "@/contexts/cart-context";
import { ShoppingCart, X, Loader2, Package, ArrowRight, Trash2, FileText } from "lucide-react";
import { useState, useEffect } from "react";

const SEO_PACKAGE_IDS = ["dfy_seo_first_page", "dfy_seo_growth", "dfy_seo_domination", "dfy_seo_ads"];

export function CartSheet() {
  const { items, removeItem, clearCart, getTotal, getItemCount } = useCart();
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

  const seoItems = items.filter(i => SEO_PACKAGE_IDS.includes(i.id));
  const nonSeoItems = items.filter(i => !SEO_PACKAGE_IDS.includes(i.id));
  const hasSeoItems = seoItems.length > 0;
  const hasNonSeoItems = nonSeoItems.length > 0;

  const contractMutation = useMutation({
    mutationFn: async () => {
      const results = [];
      for (const seoItem of seoItems) {
        const res = await apiRequest("POST", "/api/contracts/create", { packageId: seoItem.id });
        const data = await res.json();
        results.push(data);
      }
      return results;
    },
    onSuccess: (results) => {
      seoItems.forEach(item => removeItem(item.id));

      if (results.length === 1 && !hasNonSeoItems) {
        setOpen(false);
        setLocation(`/contract/sign/${results[0].token}`);
        toast({
          title: "Contract Created",
          description: "Review and sign your SEO service agreement. A copy has been sent to your email.",
        });
      } else {
        toast({
          title: `${results.length} Contract${results.length > 1 ? "s" : ""} Sent`,
          description: "Check your email to review and sign your SEO service agreement(s). You must sign before payment is processed.",
        });
      }
    },
    onError: (err: any) => {
      if (err.message?.includes("Login required") || err.message?.includes("401")) {
        toast({ title: "Sign in required", description: "Please sign in to continue.", variant: "destructive" });
        setOpen(false);
        setLocation("/auth");
      } else {
        toast({ title: "Failed to create contract", description: err.message, variant: "destructive" });
      }
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const checkoutItems = hasNonSeoItems ? nonSeoItems : items;
      const res = await apiRequest("POST", "/api/stripe/create-cart-checkout", { items: checkoutItems });
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
        toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
      }
    },
  });

  const handleCheckout = () => {
    if (!user && !isDev) {
      setOpen(false);
      setLocation("/auth");
      return;
    }

    if (hasSeoItems && hasNonSeoItems) {
      contractMutation.mutate();
      checkoutMutation.mutate();
    } else if (hasSeoItems) {
      contractMutation.mutate();
    } else {
      checkoutMutation.mutate();
    }
  };

  const itemCount = getItemCount();
  const total = getTotal();
  const isDev = import.meta.env.DEV;
  const isProcessing = checkoutMutation.isPending || contractMutation.isPending;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="button-cart-trigger">
          <ShoppingCart className="h-5 w-5" />
          {itemCount > 0 && (
            <Badge
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px] bg-[#F97316] text-white border-none"
              data-testid="badge-cart-count"
            >
              {itemCount}
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

        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-12 space-y-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-lg" data-testid="text-cart-empty">Your cart is empty</p>
              <p className="text-sm text-muted-foreground mt-1">
                Browse our Master Class modules or Done-For-You services to get started.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setOpen(false); setLocation("/master-class"); }} data-testid="link-browse-courses">
                Master Class
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setOpen(false); setLocation("/pricing#done-for-you"); }} data-testid="link-browse-services">
                Services
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto space-y-3 py-4">
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
                        {item.type === "course_module" ? "Course Module" :
                         item.type === "course_bundle" ? "Course Bundle" :
                         item.type === "dfy_bundle" ? "Service Bundle" : "Service"}
                      </Badge>
                      {SEO_PACKAGE_IDS.includes(item.id) && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                          <FileText className="h-2.5 w-2.5" />
                          Contract Required
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold text-sm" data-testid={`text-cart-item-price-${item.id}`}>
                      ${(item.price / 100).toLocaleString()}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removeItem(item.id)}
                      data-testid={`button-remove-cart-item-${item.id}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t pt-4 space-y-3">
              {hasSeoItems && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300">
                  <FileText className="h-4 w-4 mt-0.5 shrink-0" />
                  <p className="text-xs leading-relaxed">
                    SEO packages require a signed service agreement before payment. A contract will be sent to your email for review and signature.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Subtotal</span>
                <span className="text-xl font-extrabold" data-testid="text-cart-total">
                  ${(total / 100).toLocaleString()}
                </span>
              </div>

              <Button
                className="w-full bg-[#F97316] hover:bg-[#ea6c10] text-white shadow-lg shadow-orange-500/25"
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
                ) : hasSeoItems && !hasNonSeoItems ? (
                  <>
                    <FileText className="h-4 w-4 mr-2" />
                    Send Contract for Signature
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                ) : hasSeoItems && hasNonSeoItems ? (
                  <>
                    <FileText className="h-4 w-4 mr-2" />
                    Send Contract & Checkout
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                ) : (
                  <>
                    Proceed to Checkout
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={clearCart}
                data-testid="button-clear-cart"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Clear Cart
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
