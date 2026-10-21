export const AUTH_SESSION_HINT_COOKIE = "youtube-course-viewer-session";

// The sign-in page, and the same page in "create account" mode.
export const SIGN_IN_PATH = "/signin";
export const SIGN_UP_PATH = "/signup";

export function isAuthPath(pathname: string) {
  return pathname === SIGN_IN_PATH || pathname === SIGN_UP_PATH;
}

const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuthSessionHint = {
  hasStoredSession: boolean;
  userIdHint: string | null;
};

// Runs before first paint (see app/layout.tsx) so CSS can hide the signed-out
// fallback for returning users while the static HTML hydrates.
export const AUTH_SESSION_HINT_SCRIPT = `try {
  if (/(?:^|; )${AUTH_SESSION_HINT_COOKIE}=(1|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:;|$)/i.test(document.cookie)) {
    document.documentElement.dataset.sessionHint = "";
  }
} catch {}`;

export function readAuthSessionHint(): AuthSessionHint {
  if (typeof document === "undefined") {
    return { hasStoredSession: false, userIdHint: null };
  }

  const prefix = `${AUTH_SESSION_HINT_COOKIE}=`;
  const value =
    document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith(prefix))
      ?.slice(prefix.length) ?? null;
  const userIdHint = value && USER_ID_PATTERN.test(value) ? value : null;

  return {
    hasStoredSession: value === "1" || userIdHint !== null,
    userIdHint,
  };
}

export function setAuthSessionHint(userId: string | null) {
  if (typeof document === "undefined") {
    return;
  }

  const maxAge = userId ? 60 * 60 * 24 * 365 : 0;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_SESSION_HINT_COOKIE}=${userId ?? ""}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}
