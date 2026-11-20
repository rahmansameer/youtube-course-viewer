export const AUTH_SESSION_HINT_COOKIE = "youtube-course-viewer-session";

// The sign-in page, and the same page in "create account" and "forgot
// password" modes.
export const SIGN_IN_PATH = "/signin";
export const SIGN_UP_PATH = "/signup";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
// Where the password reset email's link lands. Open signed in or out: the
// link signs the visitor in for the reset, and an expired link says so here.
export const RESET_PASSWORD_PATH = "/reset-password";

export function isAuthPath(pathname: string) {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_UP_PATH ||
    pathname === FORGOT_PASSWORD_PATH
  );
}

export type AuthRedirectResult = {
  error: string | null;
  message: string | null;
  // The link was a password reset link that signed the visitor in.
  recovery: boolean;
};

const RECOVERY_KEY = "youtube-course-viewer-password-recovery";
let redirectResult: AuthRedirectResult | null = null;

// Supabase's email links (password reset, email change) come back with the
// outcome in the URL hash: tokens on success, error_description when the
// link is used up or expired, and message when an email change still needs
// the other address confirmed. Read it before the auth client clears it;
// later calls return the same answer.
export function readAuthRedirectResult(): AuthRedirectResult {
  if (redirectResult) {
    return redirectResult;
  }
  const none = { error: null, message: null, recovery: false };
  if (typeof window === "undefined") {
    return none;
  }
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const hasToken = Boolean(params.get("access_token"));
    const result = {
      error: params.get("error_description") ?? params.get("error"),
      message: params.get("message"),
      recovery: hasToken && params.get("type") === "recovery",
    };
    if (result.recovery) {
      setPasswordRecovery(true);
    }
    redirectResult = result;
    return result;
  } catch {
    return none;
  }
}

// Drops an error or message hash from the address bar once read, so a reload
// doesn't show it again. Call after mount: Next's router restores the URL it
// loaded with while hydrating. Tokens are left for the auth client.
export function clearAuthRedirectHash() {
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (!params.get("access_token") && (params.get("error_description") || params.get("error") || params.get("message"))) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  } catch {
    // Only the address bar is affected.
  }
}

// A reset link's session may set a new password without the old one, for
// this tab only (so a reload of /reset-password still works).
export function readPasswordRecovery() {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPasswordRecovery(active: boolean) {
  try {
    if (active) {
      sessionStorage.setItem(RECOVERY_KEY, "1");
    } else {
      sessionStorage.removeItem(RECOVERY_KEY);
    }
  } catch {
    // Only a reload of the reset page is affected.
  }
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
