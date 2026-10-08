/**
 * The Postgres side of the YouTube connection (table youtube_connection,
 * server/youtube/schema.ts). Tokens are encrypted at rest with the same
 * AES-256-GCM helper the Search Console grant uses (server/gbp/token-crypto.ts,
 * key GBP_TOKEN_KEY) and are decrypted only here, for the library — nothing
 * in this file returns one to a route's response.
 */
import { decryptToken, encryptToken } from "../gbp/token-crypto";
import { scrubText } from "../ops/scrub";
import type { CompletedConnect, Deps, YoutubeGrant, YoutubeStore } from "./client";
import type { Queryable } from "./schema";

const db = async (q?: Queryable): Promise<Queryable> => q ?? (await import("../db")).pool;
const scopesOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

/** What an admin may see: no token, in any form. */
export type YoutubeStatus = {
  connected: boolean;
  needsReconnect: boolean;
  channelId: string | null;
  channelTitle: string | null;
  scopes: string[];
  connectedAt: string | null;
  connectedBy: string | null;
  lastError: { code: string | null; message: string; at: string | null } | null;
};

export async function youtubeStatus(q?: Queryable): Promise<YoutubeStatus> {
  const { rows: [r] } = await (await db(q)).query(
    `SELECT channel_id, channel_title, scopes, connected_at, connected_by_email, needs_reconnect,
            (refresh_token IS NOT NULL) AS connected, last_error_code, last_error, last_error_at
       FROM youtube_connection WHERE id = 1`);
  const connected = !!r?.connected;
  return {
    connected,
    needsReconnect: connected && !!r.needs_reconnect,
    channelId: connected ? r.channel_id : null,
    channelTitle: connected ? r.channel_title : null,
    scopes: connected ? scopesOf(r.scopes) : [],
    connectedAt: connected && r.connected_at ? new Date(r.connected_at).toISOString() : null,
    connectedBy: connected ? r.connected_by_email ?? null : null,
    lastError: r?.last_error ? { code: r.last_error_code ?? null, message: r.last_error, at: r.last_error_at ? new Date(r.last_error_at).toISOString() : null } : null,
  };
}

/** Save the one connection (replacing an earlier one) and clear the last error. */
export async function saveYoutubeConnection(c: CompletedConnect, by: { id: number; email: string | null }, q?: Queryable): Promise<void> {
  await (await db(q)).query(
    `INSERT INTO youtube_connection (id, channel_id, channel_title, refresh_token, access_token, expires_at, scopes,
                                     connected_by, connected_by_email, connected_at, needs_reconnect, last_error_code, last_error, last_error_at, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6::jsonb, $7, $8, now(), false, NULL, NULL, NULL, now())
     ON CONFLICT (id) DO UPDATE SET channel_id = $1, channel_title = $2, refresh_token = $3, access_token = $4, expires_at = $5,
       scopes = $6::jsonb, connected_by = $7, connected_by_email = $8, connected_at = now(), needs_reconnect = false,
       last_error_code = NULL, last_error = NULL, last_error_at = NULL, updated_at = now()`,
    [c.channelId, c.channelTitle, encryptToken(c.refreshToken), encryptToken(c.accessToken), c.expiresAt, JSON.stringify(c.scopes), by.id, by.email]);
}

/**
 * Remember why the last attempt failed (scrubbed, capped) without touching a
 * working connection: a wrong channel picked during a reconnect leaves the
 * existing connection exactly as it was.
 */
export async function recordYoutubeError(code: string, message: string, q?: Queryable): Promise<void> {
  await (await db(q)).query(
    `INSERT INTO youtube_connection (id, last_error_code, last_error, last_error_at) VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET last_error_code = $1, last_error = $2, last_error_at = now(), updated_at = now()`,
    [code.slice(0, 40), scrubText(message, 600)]);
}

/** The refresh token to revoke at Google on disconnect (null when there is none or it cannot be read). */
export async function youtubeRefreshTokenForRevoke(q?: Queryable): Promise<string | null> {
  const { rows: [r] } = await (await db(q)).query(`SELECT refresh_token FROM youtube_connection WHERE id = 1`);
  try { return decryptToken(r?.refresh_token ?? null); } catch { return null; }
}

/**
 * Delete everything stored about the channel: the row holds the channel id and
 * title, both tokens, the scopes and the last error, and there is no other
 * YouTube table or cache. True when a connection was removed.
 */
export async function deleteYoutubeConnection(q?: Queryable): Promise<boolean> {
  const { rows } = await (await db(q)).query(`DELETE FROM youtube_connection WHERE id = 1 RETURNING (refresh_token IS NOT NULL) AS connected`);
  return !!rows[0]?.connected;
}

export function pgYoutubeStore(q?: Queryable): YoutubeStore {
  return {
    async load(): Promise<YoutubeGrant | null> {
      const { rows: [r] } = await (await db(q)).query(
        `SELECT channel_id, refresh_token, access_token, expires_at, scopes, needs_reconnect FROM youtube_connection WHERE id = 1`);
      if (!r?.refresh_token) return null;
      return {
        channelId: r.channel_id,
        refreshToken: decryptToken(r.refresh_token),
        accessToken: decryptToken(r.access_token),
        expiresAt: r.expires_at ? new Date(r.expires_at) : null,
        scopes: scopesOf(r.scopes),
        needsReconnect: !!r.needs_reconnect,
      };
    },
    async saveAccess(t) {
      await (await db(q)).query(
        `UPDATE youtube_connection SET access_token = $1, expires_at = $2, refresh_token = COALESCE($3, refresh_token), updated_at = now() WHERE id = 1`,
        [encryptToken(t.accessToken), t.expiresAt, encryptToken(t.refreshToken)]);
    },
    async markNeedsReconnect(reason) {
      await (await db(q)).query(
        `UPDATE youtube_connection SET needs_reconnect = true, access_token = NULL, expires_at = NULL,
                last_error_code = 'needs_reconnect', last_error = $1, last_error_at = now(), updated_at = now() WHERE id = 1`,
        [scrubText(reason, 600)]);
    },
  };
}

/** The library's dependencies against the real database and the real network. */
export const youtubeDeps = (): Deps => ({ store: pgYoutubeStore() });
