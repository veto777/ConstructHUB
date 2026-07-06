const SESSION_KEY = "admin_session";
const LEGACY_KEY = "admin_authenticated";
const TOKEN_KEY = "admin_token";
const DAY_MS = 24 * 60 * 60 * 1000;

interface AdminSession {
  authenticated: boolean;
  expiresAt: number | null;
}

export function setAdminSession(keepLoggedIn: boolean, token?: string): void {
  const session: AdminSession = {
    authenticated: true,
    expiresAt: keepLoggedIn ? null : Date.now() + DAY_MS,
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(LEGACY_KEY, "true");
    if (token) localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore storage errors
  }
}

// Server-verified token, sent on sensitive endpoints (e.g. the Code Editor).
export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearAdminSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage errors
  }
}

export function isAdminAuthenticated(): boolean {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const session = JSON.parse(raw) as AdminSession;
      if (!session.authenticated) {
        clearAdminSession();
        return false;
      }
      if (session.expiresAt !== null && Date.now() > session.expiresAt) {
        clearAdminSession();
        return false;
      }
      return true;
    }

    // Migrate any old "logged in forever" flag to a fresh 24-hour session.
    if (localStorage.getItem(LEGACY_KEY) === "true") {
      setAdminSession(false);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
