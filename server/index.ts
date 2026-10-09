// FIRST: a process that asks for tutorial fixtures outside a recording slot refuses to boot (server/tutorials/fixtures/gate.ts).
import "./tutorials/fixtures/boot-guard";
import { registerAppPurchaseGuard } from "./app-purchases";
import { credentialBody } from "./cloudflare/credential-body";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { setupAuth } from "./auth";
import { createServer } from "http";

const app = express();
registerAppPurchaseGuard(app);
app.set("trust proxy", 1);
const httpServer = createServer(app);
import { registerInboundMail } from "./mail-alerts/inbound";
registerInboundMail(app);
import { registerPrivateIntegrationParsers } from "./domains/private-http";
registerPrivateIntegrationParsers(app);
// SignalWire reaches the Call Assistant engine (voice/, on the tower GPU)
// through this app: /voice/* is proxied raw — before any body parser — to
// VOICE_ENGINE_URL, including the media-stream WebSocket upgrade.
import { registerVoiceProxy } from "./voice/proxy";
registerVoiceProxy(app, httpServer);
// An account API key (chub_…) authenticates ONLY /api/v1: anywhere else it is
// refused before any parser or handler runs (the AI routes included).
import { isPublicApiPath, rejectApiKeysOutsidePublicApi } from "./public-api/guard";
import { apiError, codeForStatus } from "./public-api/errors";
app.use(rejectApiKeysOutsidePublicApi);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(["/api/cloudflare", "/api/gsc"], credentialBody);

// Bound public AI/photo JSON before the general parser; Stripe raw-body stays intact.
app.use(["/api/site-assistant", "/api/ads-consultant", "/api/review", "/api/photos", "/api/gmb/review-response"], express.json({ limit: "32kb" }));
// The browser's error reports (issue desk): small, anonymous, capped before the big parser below.
import { CLIENT_ERROR_PATH, CLIENT_ERROR_BODY_LIMIT } from "./ops/client-errors";
app.use(CLIENT_ERROR_PATH, express.json({ limit: CLIENT_ERROR_BODY_LIMIT }));
// A person's own report (/report-issue): text plus an optional screenshot (≤ 5 MB), capped before the big parser below.
import { USER_REPORT_PATH, USER_REPORT_BODY_LIMIT } from "./ops/user-reports";
app.use(USER_REPORT_PATH, express.json({ limit: USER_REPORT_BODY_LIMIT }));
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

// The issue desk: a 500 a route answered by itself is recorded when the response finishes.
import { watchHandledFailures, recordUnhandledError, recordProcessFailure } from "./ops/server-errors";
app.use(watchHandledFailures);

app.use((req, res, next) => {
  const start = Date.now();
  const isSiteScan = req.path.startsWith("/api/agency") || req.path.startsWith("/api/sitescan") || req.path.startsWith("/api/admin/sitescan");
  const path = isSiteScan ? req.path.replace(/[a-f0-9]{64}/g, ":token") : req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    if (!isSiteScan && !req.path.startsWith("/api/domains") && !req.path.startsWith("/api/mail-alerts")) capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      // Auth/consent bodies (QR seeds, recovery codes), social bodies (signed upload URLs), the public
      // API's responses (account data handed to third-party tools) and the API-key endpoints (one-time
      // secrets) never reach logs.
      if (capturedJsonResponse && !path.startsWith("/api/auth/") && !path.startsWith("/api/gbp/connect") && !path.startsWith("/api/social") && !path.startsWith("/api/ads") && !path.startsWith("/api/cloudflare") && !path.startsWith("/api/gsc")
        && !path.startsWith("/api/v1") && !path.startsWith("/api/account/api-keys")
        // Call Assistant: transcripts, summaries and caller details never reach the request log
        && !path.startsWith("/api/crm/voice") && !path.startsWith("/api/voice-internal")
        // Issue desk: captured failures and Claude's reports stay out of the request log too
        && !path.startsWith("/api/admin/issues") && !path.startsWith("/api/ops-internal") && !path.startsWith("/api/ops/")) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  recordProcessFailure("uncaughtException", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  recordProcessFailure("unhandledRejection", reason);
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
    // Account pricing terms (server/billing/pricing-terms.ts): the tables, the
    // one-time SEO cutover and the reconciliation of late subscription webhooks.
    // Awaited here, outside billingSchemaReady's retry-later catch, so a failure
    // fails boot like seedDatabase above: serving requests on a rolled-back
    // cutover would deny existing customers their SEO tools and could
    // grandfather accounts that signed up after it.
    const { ensurePricingTerms } = await import("./billing/pricing-terms");
    await ensurePricingTerms();
    await setupAuth(app);
    await registerRoutes(httpServer, app);

    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      const status = typeof err.code === "string" && err.code.startsWith("LIMIT_") ? 413 : (err.status || err.statusCode || 500);
      const message = err.message || "Internal Server Error";

      console.error("Internal Server Error:", err);
      // The issue desk: any 5xx that reached this handler (route + method + error identity).
      recordUnhandledError(req, res, err, status);

      if (res.headersSent) {
        return next(err);
      }

      // The public API answers its one error envelope even for failures raised
      // before its router (the app-level JSON parser: malformed or oversized body).
      if (isPublicApiPath(req.path)) {
        const isBodyError = typeof err?.type === "string" && err.type.startsWith("entity.");
        if (status >= 500) return apiError(res, 500, "internal_error", "Something went wrong on our side. Try again shortly.");
        return apiError(res, status, codeForStatus(status), isBodyError ? "The request body could not be read as JSON." : message);
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
