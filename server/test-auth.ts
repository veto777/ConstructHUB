import type { RequestHandler } from "express";

export function testAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CRM_DEMO_AUTOLOGIN === "true" ||
    (env.DEV_AUTH_BYPASS_USER1 === "true" && env.NODE_ENV !== "production");
}

// Installed once, after Passport. Never overrides a real session, and never
// persists a test identity into the session store.
export function testAuthAdapter(loadUser: () => Promise<any>): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user && testAuthEnabled()) {
        const user = await loadUser();
        if (user) req.user = user;
      }
      next();
    } catch (error) { next(error); }
  };
}
