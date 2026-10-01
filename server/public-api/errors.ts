import type { Response } from "express";

/**
 * The one error envelope of the public API: { error: { code, message, … } }.
 * `code` is stable and machine-readable; `message` is for humans.
 */
export function apiError(res: Response, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ error: { code, message, ...extra } });
}
