import { NextResponse, type NextRequest } from "next/server";

import { AUTH_SESSION_HINT_COOKIE } from "@/lib/auth-session-hint";

// Visitors without a session go to the sign-in page before any app page is
// served, so they never see a flash of the library. The cookie is only a
// hint (AuthGate checks the real Supabase session in the browser), so this
// never redirects away from /login; AuthGate does that once signed in.
export function proxy(request: NextRequest) {
  if (request.cookies.get(AUTH_SESSION_HINT_COOKIE)?.value) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" && !search ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Every page except the sign-in page, API routes, Next.js assets and
  // files with an extension (favicon, images).
  matcher: ["/((?!login|api|_next/|.*\\..*).*)"],
};
