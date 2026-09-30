import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { toast } from "@/hooks/use-toast";
import { BUNDLE_NAMES, bundleIdOf, coveringBundleOf, withoutBundledParts } from "@shared/cart-bundles";
import { isSalesOnlyCartItem } from "@/lib/pricing-display";

export type CartItemType = "course_module" | "course_bundle" | "dfy_service" | "dfy_bundle";

export interface CartItem {
  id: string;
  type: CartItemType;
  name: string;
  price: number;
  description?: string;
  moduleId?: number;
}

/** Something priced at $1,000 or more that someone tried to buy: it goes to a sales rep, never checkout. */
export interface SalesOnlyItem {
  id: string;
  name: string;
}

interface CartContextValue {
  items: CartItem[];
  /** Adds the item; false when it was not added (already there, in a bundle, or sold through a sales rep). */
  addItem: (item: CartItem) => boolean;
  removeItem: (id: string) => void;
  clearCart: () => void;
  getTotal: () => number;
  getItemCount: () => number;
  /** True when the item is in the cart, or already included in a bundle that is. */
  isInCart: (id: string) => boolean;
  /** Items the cart turned away because a sales rep prices them. */
  salesItems: SalesOnlyItem[];
  dismissSalesItem: (id: string) => void;
}

const STORAGE_KEY = "constructhub_cart";
/** Sales requests waiting in the cart, kept until sent or dismissed. */
const SALES_STORAGE_KEY = "constructhub_cart_sales";

const CartContext = createContext<CartContextValue | null>(null);

/** One entry per item id (the first one wins); an entry without an id is dropped. */
function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(i => {
    if (!i || typeof i.id !== "string" || seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

function loadSalesItems(): SalesOnlyItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SALES_STORAGE_KEY) || "[]");
    if (Array.isArray(parsed)) {
      return uniqueById(parsed.filter(i => i && typeof i.id === "string").map(i => ({ id: i.id, name: String(i.name ?? i.id) })));
    }
  } catch {}
  return [];
}

function loadCart(): { items: CartItem[]; salesItems: SalesOnlyItem[] } {
  const waiting = loadSalesItems();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // A stored cart that repeats an item id showed it twice and doubled the
      // subtotal. A cart saved before bundles were enforced may also hold a
      // bundle AND its parts — the bundle already includes them. Drop both kinds
      // of duplicate. A cart saved before services of $1,000 or more became
      // "Talk to a sales rep" may hold one: it leaves checkout and stays in the
      // cart as a sales request instead.
      if (Array.isArray(parsed)) {
        const all = withoutBundledParts(uniqueById(parsed as CartItem[]));
        return {
          items: all.filter(i => !isSalesOnlyCartItem(i)),
          salesItems: uniqueById([
            ...waiting,
            ...all.filter(i => isSalesOnlyCartItem(i)).map(i => ({ id: i.id, name: String(i.name ?? i.id) })),
          ]),
        };
      }
    }
  } catch {}
  return { items: [], salesItems: waiting };
}

function saveCart(items: CartItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

function saveSalesItems(items: SalesOnlyItem[]) {
  try {
    if (items.length) localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(items));
    else localStorage.removeItem(SALES_STORAGE_KEY);
  } catch {}
}

// Callers toast "Added to cart" right after addItem and only one toast shows at
// a time — defer ours so the bundle notice is the one the shopper sees.
function notifyLater(title: string, description: string) {
  setTimeout(() => toast({ title, description }), 0);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(loadCart);
  const [items, setItems] = useState<CartItem[]>(initial.items);
  const [salesItems, setSalesItems] = useState<SalesOnlyItem[]>(initial.salesItems);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    saveCart(items);
  }, [items]);

  useEffect(() => {
    saveSalesItems(salesItems);
  }, [salesItems]);

  const addItem = useCallback((item: CartItem) => {
    // $1,000 and up is priced by a sales rep: never a cart line or a checkout.
    if (isSalesOnlyCartItem(item)) {
      setSalesItems(prev => uniqueById([...prev, { id: item.id, name: item.name }]));
      notifyLater("Talk to a sales rep", `${item.name} is priced with a sales rep, not at checkout. Open the cart to send a request.`);
      return false;
    }

    const current = itemsRef.current;
    if (current.some(i => i.id === item.id)) return false;

    // A bundle in the cart already includes this item — never charge twice.
    const covering = coveringBundleOf(item);
    if (covering && current.some(i => bundleIdOf(i) === covering)) {
      notifyLater("Already in your cart", `${item.name} is included in the ${BUNDLE_NAMES[covering]} in your cart.`);
      return false;
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
    return true;
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  /** Empties the checkout lines; waiting sales requests stay until sent or dismissed. */
  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const dismissSalesItem = useCallback((id: string) => {
    setSalesItems(prev => prev.filter(i => i.id !== id));
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
    <CartContext.Provider value={{ items, addItem, removeItem, clearCart, getTotal, getItemCount, isInCart, salesItems, dismissSalesItem }}>
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
