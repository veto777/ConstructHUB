import express, { type Express } from "express";
import { timingSafeEqual, createHash } from "node:crypto";
import { ingest } from "./service";
import { rateLimit } from "../growth-limits";
/** Register before the application's general parser/logger. Never log bodies or parser errors. */
export function registerInboundMail(app: Express) {
  app.post(
    "/api/inbound-mail",
    (req, res, next) => {
      const expected = process.env.INBOUND_MAIL_SECRET,
        actual = req.get("x-inbound-mail-secret");
      if (
        !expected ||
        !actual ||
        !timingSafeEqual(
          createHash("sha256").update(expected).digest(),
          createHash("sha256").update(actual).digest(),
        )
      )
        return void res.status(401).json({ message: "Unauthorized" });
      next();
    },
    rateLimit("inbound-mail", 2000, 2000, 60000),
    express.raw({ type: () => true, limit: "256kb" }),
    async (req, res) => {
      try {
        const raw = req.is("application/json")
          ? JSON.parse(req.body.toString("utf8"))
          : req.body;
        const recipient = req.get("x-inbound-mail-to");
        if (recipient && recipient.length > 1000) throw new Error();
        await ingest(raw, recipient);
        res.status(202).json({ accepted: true });
      } catch {
        res.status(400).json({ message: "Invalid inbound message" });
      }
    },
  );
  app.use("/api/inbound-mail", (err: any, _req: any, res: any, _next: any) =>
    res
      .status(err?.type === "entity.too.large" ? 413 : 400)
      .json({ message: "Invalid inbound message" }),
  );
}
