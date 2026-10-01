import { credentialBody } from "./cloudflare/credential-body";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { isSiteScanPath, responseBodyLoggable } from "./request-log";
import { setupAuth } from "./auth";
import { createServer } from "http";

const app = express();
app.set("trust proxy", 1);
const httpServer = createServer(app);
import { registerInboundMail } from "./mail-alerts/inbound";
registerInboundMail(app);
import { registerPrivateIntegrationParsers } from "./domains/private-http";
registerPrivateIntegrationParsers(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(["/api/cloudflare", "/api/gsc"], credentialBody);

// Bound public AI/photo JSON before the general parser; Stripe raw-body stays intact.
// The Hub assistant gets the smallest body of all, and a body it can't parse is
// answered here (never by the global error handler, which logs the error).
app.use("/api/hub", express.json({ limit: "8kb" }), (err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err?.type === "entity.too.large" ? 413 : 400).json({ message: "Request too large or not valid JSON." });
});
app.use(["/api/ads-consultant", "/api/review", "/api/photos", "/api/gmb/review-response"], express.json({ limit: "32kb" }));
app.use("/api/ads", express.json({ limit: "512kb" }));
app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "50mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const isSiteScan = isSiteScanPath(req.path);
  const path = isSiteScan ? req.path.replace(/[a-f0-9]{64}/g, ":token") : req.path;
  // Hub replies, auth/consent bodies (QR seeds, recovery codes) and social bodies (signed upload URLs)
  // never reach logs, whatever the path's case (server/request-log.ts).
  const loggable = responseBodyLoggable(req.path);
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    if (loggable) capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.toLowerCase().startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

(async () => {
  try {
    const { seedDatabase } = await import("./seed");
    await seedDatabase();
    const { ensureGrowthSchema } = await import("./growth-schema");
    await ensureGrowthSchema();
    // shared/schema.ts `subscriptions` lists the billing columns, so every
    // drizzle select of it (routes, CRM tenancy, admin) needs them to exist
    // before the first request. registerStripeRoutes starts this step; boot
    // waits for it here.
    const { billingSchemaReady } = await import("./billing/sync");
    await billingSchemaReady();
    await setupAuth(app);
    await registerRoutes(httpServer, app);

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = typeof err.code === "string" && err.code.startsWith("LIMIT_") ? 413 : (err.status || err.statusCode || 500);
      const message = err.message || "Internal Server Error";

      console.error("Internal Server Error:", err);

      if (res.headersSent) {
        return next(err);
      }

      return res.status(status).json({ message });
    });

    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    const port = parseInt(process.env.PORT || "5000", 10);
    httpServer.listen(
      {
        port,
        host: "0.0.0.0",
        reusePort: true,
      },
      () => {
        log(`serving on port ${port}`);
      },
    );
  } catch (err) {
    console.error("Fatal startup error:", err);
    process.exit(1);
  }
})();
