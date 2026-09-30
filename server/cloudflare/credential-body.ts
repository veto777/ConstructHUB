import express, { type RequestHandler } from "express";
/** Express parse errors retain err.body. Do not let credential bodies reach the generic error logger. */
export const credentialBody: RequestHandler = (req, res, next) => {
  if (req.method === "POST" && !req.is("application/json")) {
    res.status(415).json({ message: "Send a JSON request body" });
    return;
  }
  express.json({ limit: "64kb" })(req, res, (error?: unknown) => {
    if (error) {
      req.body = undefined;
      req.rawBody = undefined;
      res.status(400).json({ message: "Invalid JSON request body" });
      return;
    }
    next();
  });
};
