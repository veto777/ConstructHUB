import { eq } from "drizzle-orm";
import { coursePurchases } from "@shared/schema";
import { db } from "./db";
import { hasModule } from "./entitlements";

/** Resolve subscription access independently of permanent course purchases. */
export async function getCourseAccess(userId: number | null) {
  if (userId === null) return { included: false, purchases: [] };
  const [included, purchases] = await Promise.all([
    hasModule(userId, "masterClass"),
    db.select().from(coursePurchases).where(eq(coursePurchases.userId, userId)),
  ]);
  return { included, purchases };
}
