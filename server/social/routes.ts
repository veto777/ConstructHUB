import { syncGbpSources } from "./gbp-sources";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { rateLimit } from "../growth-limits";
import { autoSchema, opaqueId, publicMediaUrl } from "../../shared/social";
import { SocialError } from "./client";
import {
  connect,
  disconnect,
  discoverPages,
  createPosts,
  changePost,
  saveSettings,
  userLock,
  generateDue,
  connection,
  type ClientFactory,
  clientFactory,
} from "./service";
export function registerSocialRoutes(
  app: Express,
  auth: (req: any, res: any) => any,
  make: ClientFactory = clientFactory,
) {
  const gate = rateLimit("social", 60, 120);
  const route = (
    method: "get" | "post" | "put" | "delete",
    path: string,
    fn: (req: Request, res: Response, id: number) => Promise<any>,
  ) => {
    app[method](
      `/api/social${path}`,
      (req, res, next) => {
        if (auth(req, res)) next();
      },
      ...(method === "get" ? [] : [gate]),
      async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        try {
          await fn(req, res, req.user!.id);
        } catch (e) {
          res
            .status(
              e instanceof SocialError
                ? e.status
                : e instanceof z.ZodError
                  ? 400
                  : 500,
            )
            .json({
              message:
                e instanceof SocialError
                  ? e.message
                  : e instanceof z.ZodError
                    ? "Invalid Social Media input"
                    : "Social Media operation could not be completed. Check your input and retry.",
            });
        }
      },
    );
  };
  route("get", "", async (_req, res, id) => {
    const {
      rows: [c],
    } = await pool.query(
      "SELECT accounts,updated_at FROM social_connections WHERE user_id=$1",
      [id],
    );
    const {
      rows: [s],
    } = await pool.query(
      "SELECT settings,next_at,last_error FROM social_settings WHERE user_id=$1",
      [id],
    );
    const { rows: posts } = await pool.query(
      "SELECT * FROM social_posts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200",
      [id],
    );
    res.json({
      connected: !!c,
      accounts: c?.accounts || [],
      settings: s?.settings || autoSchema.parse({}),
      nextAt: s?.next_at,
      lastError: s?.last_error,
      posts,
    });
  });
  route("post", "/connect", async (req, res, id) => {
    const { apiKey } = z
      .object({ apiKey: z.string().trim().min(8).max(512) })
      .strict()
      .parse(req.body);
    res.json(await connect(id, apiKey, req, make));
  });
  route("post", "/disconnect", async (_req, res, id) =>
    res.json(await disconnect(id, _req)),
  );
  route("post", "/accounts/:id/pages", async (req, res, id) =>
    res.json(await discoverPages(id, opaqueId.parse(req.params.id), make)),
  );
  route("post", "/posts", async (req, res, id) =>
    res.status(201).json({ posts: await createPosts(id, req.body) }),
  );
  route("post", "/posts/:id/action", async (req, res, id) => {
    const body = z
      .object({
        action: z.enum(["approve", "cancel"]),
        text: z.string().trim().min(1).max(63206).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await changePost(
        id,
        z.string().uuid().parse(req.params.id),
        body.action,
        body.text,
      ),
    );
  });
  route("put", "/settings", async (req, res, id) =>
    res.json(await saveSettings(id, req.body)),
  );
  route("post", "/generate", async (_req, res, id) =>
    res.json({
      posts: await userLock(id, (c) => generateDue(c, id, undefined, true)),
    }),
  );
  route("get", "/media", async (_req, res, id) => {
    const { rows } = await pool.query(
      "SELECT id,name,url FROM media_photos WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200",
      [id],
    );
    res.json(rows.filter((r) => publicMediaUrl.safeParse(r.url).success));
  });
  route("post", "/uploads", async (req, res, id) => {
    const { filename } = z
      .object({
        filename: z
          .string()
          .min(1)
          .max(160)
          .regex(/^[\w .-]+\.(jpg|jpeg|png|webp|mp4|mov)$/i),
      })
      .strict()
      .parse(req.body);
    const { client } = await connection(id, make);
    const data = await client.request("/media/uploads", { filename });
    const publicUrl = publicMediaUrl.parse(data.publicUrl),
      presignedUrl = publicMediaUrl.parse(data.presignedUrl);
    res.json({ publicUrl, presignedUrl });
  });
  route("post", "/sources/sync-gbp", async (_req, res, id) =>
    res.json(await userLock(id, () => syncGbpSources(id))),
  );
  route("get", "/sources", async (_req, res, id) =>
    res.json(
      (
        await pool.query(
          "SELECT * FROM social_sources WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
          [id],
        )
      ).rows,
    ),
  );
  route("post", "/sources", async (req, res, id) => {
    const input = z
      .object({
        kind: z.enum(["offers", "gbp"]),
        text: z.string().trim().min(1).max(4000),
        mediaUrls: z.array(publicMediaUrl).max(10).default([]),
      })
      .strict()
      .parse(req.body);
    const {
      rows: [row],
    } = await pool.query(
      "INSERT INTO social_sources(user_id,kind,text,media_urls) VALUES($1,$2,$3,$4) RETURNING *",
      [id, input.kind, input.text, JSON.stringify(input.mediaUrls)],
    );
    res.status(201).json(row);
  });
  route("delete", "/sources/:id", async (req, res, id) => {
    const sourceId = z.coerce.number().int().positive().parse(req.params.id);
    const r = await pool.query(
      "DELETE FROM social_sources WHERE id=$1 AND user_id=$2",
      [sourceId, id],
    );
    if (!r.rowCount) throw new SocialError("Source not found", 404);
    res.json({ ok: true });
  });
}
