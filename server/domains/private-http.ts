import express, { type Express, type ErrorRequestHandler } from "express";
/** Prevent the global JSON parser/error logger from retaining malformed credential payloads. */
export function registerPrivateIntegrationParsers(app: Express) {
  const paths = ["/api/domains", "/api/mail-alerts"];
  app.use(paths, express.json({ limit: "64kb" }));
  const safeError: ErrorRequestHandler = (err, _req, res, _next) => {
    res
      .status(err?.type === "entity.too.large" ? 413 : 400)
      .json({ message: "Invalid integration request" });
  };
  app.use(paths, safeError);
}
