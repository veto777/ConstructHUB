import { eq, isNull, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
export type OwnerScope = { id: number; admin: boolean };
export function ownedBy(column: AnyPgColumn, owner: OwnerScope): SQL {
  return owner.admin ? or(eq(column, owner.id), isNull(column))! : eq(column, owner.id);
}
