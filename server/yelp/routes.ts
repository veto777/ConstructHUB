/** Yelp reputation routes — read-only reviews, AI-drafted replies, nearby competitors. Auth required. */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { rateLimit } from "../growth-limits";
import { YelpError, yelpConfigured } from "./client";
import { ensureYelpSchema, search, connect, list, refresh, disconnect, competitors, draftReply } from "./service";

export function registerYelpRoutes(app: Express, auth: (req: any, res: any) => any) {
  void ensureYelpSchema().catch((e) => console.warn("[yelp] schema:", (e as Error)?.message));
  app.use("/api/yelp", rateLimit("yelp", 60, 120));
  // AI drafting is heavier; its own tighter limit.
  app.use("/api/yelp/businesses/:id/reviews/:reviewId/draft", rateLimit("yelp-draft", 20, 40));

  const route = (method: "get" | "post" | "delete", path: string, fn: (req: Request, res: Response, userId: number) => Promise<any>) => {
    app[method](`/api/yelp${path}`, async (req: Request, res: Response) => {
      const user = auth(req, res); if (!user) return;
      try { await fn(req, res, user.id); }
      catch (e) {
        if (e instanceof YelpError) { const status = e.status === 401 ? 502 : e.status; return res.status(status).json({ message: e.status === 401 ? "Yelp sign-in needs attention on the server" : e.message }); }
        if (e instanceof z.ZodError) return res.status(400).json({ message: e.issues[0]?.message ?? "Invalid input" });
        console.warn("[yelp] route error:", (e as Error)?.message);
        res.status(500).json({ message: "Yelp request failed" });
      }
    });
  };
  const bizId = (v: unknown) => z.coerce.number().int().positive().parse(v);

  route("get", "/status", async (_req, res) => { res.json({ available: yelpConfigured() }); });
  route("get", "/search", async (req, res, id) => {
    const { term, location } = z.object({ term: z.string().trim().min(2).max(120), location: z.string().trim().min(2).max(120) }).parse({ term: req.query.term, location: req.query.location });
    res.json({ results: await search(id, term, location) });
  });
  route("post", "/connect", async (req, res, id) => {
    const { yelpId } = z.object({ yelpId: z.string().trim().min(1).max(128) }).strict().parse(req.body);
    res.json(await connect(id, yelpId));
  });
  route("get", "/businesses", async (_req, res, id) => { res.json({ businesses: await list(id) }); });
  route("post", "/businesses/:id/refresh", async (req, res, id) => { res.json(await refresh(id, bizId(req.params.id))); });
  route("delete", "/businesses/:id", async (req, res, id) => { res.json(await disconnect(id, bizId(req.params.id))); });
  route("get", "/businesses/:id/competitors", async (req, res, id) => { res.json({ competitors: await competitors(id, bizId(req.params.id)) }); });
  route("post", "/businesses/:id/reviews/:reviewId/draft", async (req, res, id) => {
    const reviewId = z.string().trim().min(1).max(64).parse(req.params.reviewId);
    res.json(await draftReply(id, bizId(req.params.id), reviewId));
  });
}
