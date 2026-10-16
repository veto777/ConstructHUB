/**
 * The HTTP handler every R2 S3Client uses (server/r2.ts, server/jobcam/storage.ts, server/tutorials/media.ts).
 *
 * Incident 2026-10-15: the SDK default is a keep-alive agent with 50 sockets and NO timeouts. A GetObject
 * response body that is never read or destroyed keeps its socket checked out; after 50 of those every
 * later send() waited in the agent queue forever. So:
 *   · connectionTimeout — a TCP/TLS connect that does not finish fails instead of waiting;
 *   · throwOnRequestTimeout — a request that breaches `requestTimeout` FAILS (TimeoutError) instead of only
 *     logging. The timer runs from send() until the response headers, so it includes time spent queued for
 *     a socket. No client-wide requestTimeout is set (a big upload can take minutes to send its body);
 *     reads pass one per call — R2_READ_TIMEOUT_MS;
 *   · socketTimeout — a socket idle that long is destroyed, which also reclaims one held by a body that
 *     someone forgot to consume;
 *   · a bounded keep-alive pool, and an early warning when it is exhausted.
 */
import { NodeHttpHandler } from "@smithy/node-http-handler";

/** Time to the first byte of a GetObject, queue wait included. */
export const R2_READ_TIMEOUT_MS = 30_000;

export function r2RequestHandler(overrides: { connectionTimeout?: number; socketTimeout?: number; maxSockets?: number } = {}): NodeHttpHandler {
  const maxSockets = overrides.maxSockets ?? 64;
  return new NodeHttpHandler({
    connectionTimeout: overrides.connectionTimeout ?? 5_000,
    socketTimeout: overrides.socketTimeout ?? 120_000,
    throwOnRequestTimeout: true,
    socketAcquisitionWarningTimeout: 5_000,
    // Options, not Agent instances: the handler then builds the agents itself and keeps its own
    // 100-continue handling for large uploads.
    httpsAgent: { keepAlive: true, maxSockets },
    httpAgent: { keepAlive: true, maxSockets },
  });
}

/** True for the SDK's timeout failures (requestTimeout, connectionTimeout, socketTimeout). */
export function isR2Timeout(e: any): boolean {
  return e?.name === "TimeoutError" || e?.code === "ETIMEDOUT";
}
