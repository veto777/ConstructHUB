import { z } from 'zod';
export const hitPageInput = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
});
/** IDs give a stable insertion order even when matches share a timestamp. */
export function hitPage<T extends { id: number }>(rows: T[], limit: number) {
  const hits = rows.slice(0, limit);
  return { hits, nextCursor: rows.length > limit ? hits.at(-1)!.id : null };
}
