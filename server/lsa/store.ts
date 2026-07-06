import { db } from "../db";
import { lsaConnections, lsaAccounts, type LsaConnection } from "@shared/schema";
import { and, eq } from "drizzle-orm";

/** Load a user's single Google Ads connection (one per user). */
export async function getConnectionByUserId(userId: number): Promise<LsaConnection | undefined> {
  const rows = await db.select().from(lsaConnections).where(eq(lsaConnections.userId, userId)).limit(1);
  return rows[0];
}

/** Find a connection by the Telegram chat id we captured at link time. */
export async function getConnectionByChatId(chatId: string): Promise<LsaConnection | undefined> {
  const rows = await db.select().from(lsaConnections).where(eq(lsaConnections.telegramChatId, chatId)).limit(1);
  return rows[0];
}

/** Find a connection by its one-time Telegram deep-link token. */
export async function getConnectionByLinkToken(token: string): Promise<LsaConnection | undefined> {
  const rows = await db.select().from(lsaConnections).where(eq(lsaConnections.telegramLinkToken, token)).limit(1);
  return rows[0];
}

/** Resolve the login-customer-id (manager context) for a tenant's account, if known. */
export async function loginCidFor(userId: number, customerId: string): Promise<string | null> {
  const rows = await db
    .select({ l: lsaAccounts.loginCustomerId })
    .from(lsaAccounts)
    .where(and(eq(lsaAccounts.userId, userId), eq(lsaAccounts.customerId, customerId)))
    .limit(1);
  return rows[0]?.l ?? null;
}
