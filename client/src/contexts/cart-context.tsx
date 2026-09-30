import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { toast } from "@/hooks/use-toast";
import { BUNDLE_NAMES, bundleIdOf, coveringBundleOf, withoutBundledParts } from "@shared/cart-bundles";

export type CartItemType = "course_module" | "course_bundle" | "dfy_service" | "dfy_bundle";

export interface CartItem {
  id: string;
  type: CartItemType;
  name: string;
  price: number;
  description?: string;
  moduleId?: number;
}

interface CartContextValue {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  getTotal: () => number;
  getItemCount: () => number;
  /** True when the item is in the cart, or already included in a bundle that is. */
  isInCart: (id: string) => boolean;
}

const STORAGE_KEY = "constructhub_cart";

const CartContext = createContext<CartContextValue | null>(null);

/** One entry per item id (the first one wins); an entry without an id is dropped. */
function uniqueById(items: CartItem[]): CartItem[] {
  const seen = new Set<string>();
  return items.filter(i => {
    if (!i || typeof i.id !== "string" || seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

function loadCart(): CartItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // A stored cart that repeats an item id showed it twice and doubled the
      // subtotal. A cart saved before bundles were enforced may also hold a
      // bundle AND its parts — the bundle already includes them. Drop both kinds
      // of duplicate.
      if (Array.isArray(parsed)) return withoutBundledParts(uniqueById(parsed));
    }
  } catch {}
  return [];
}

function saveCart(items: CartItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

// Callers toast "Added to cart" right after addItem and only one toast shows at
// a time — defer ours so the bundle notice is the one the shopper sees.
function notifyLater(title: string, description: string) {
  setTimeout(() => toast({ title, description }), 0);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(loadCart);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    saveCart(items);
  }, [items]);

  const addItem = useCallback((item: CartItem) => {
    const current = itemsRef.current;
    if (current.some(i => i.id === item.id)) return;

    // A bundle in the cart already includes this item — never charge twice.
    const covering = coveringBundleOf(item);
    if (covering && current.some(i => bundleIdOf(i) === covering)) {
      notifyLater("Already in your cart", `${item.name} is included in the ${BUNDLE_NAMES[covering]} in your cart.`);
      return;
    }

    // Adding a bundle replaces the parts of it that are already in the cart.
    const bundleId = bundleIdOf(item);
    const replaced = bundleId ? current.filter(i => coveringBundleOf(i) === bundleId) : [];
    const next = uniqueById([...current.filter(i => !replaced.includes(i)), item]);
    itemsRef.current = next;
    setItems(next);
    if (bundleId && replaced.length) {
      notifyLater(
        `${BUNDLE_NAMES[bundleId]} added`,
        `It already includes ${replaced.map(i => i.name).join(", ")}, so ${replaced.length === 1 ? "that item was" : "those items were"} removed from your cart.`,
      );
    }
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const getTotal = useCallback(() => {
    return items.reduce((sum, item) => sum + item.price, 0);
  }, [items]);

  const getItemCount = useCallback(() => {
    return items.length;
  }, [items]);

  const isInCart = useCallback((id: string) => {
    if (items.some(i => i.id === id)) return true;
    const covering = coveringBundleOf({ id });
    return !!covering && items.some(i => bundleIdOf(i) === covering);
  }, [items]);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, clearCart, getTotal, getItemCount, isInCart }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
