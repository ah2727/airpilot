// middleware.ts
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/_next",            // Next internals
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  "/api/auth/login",   // allow login API
  "/api/auth/logout",  // allow logout API
  "/public",           // if you serve assets from /public
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  // Read token from httpOnly cookie (set by our API route)
  const token = req.cookies.get("access_token")?.value;

  // Not logged in -> redirect to /login?next=<original>
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Already logged in -> allow
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Protect everything except API/public/login/_next/etc.
    "/((?!_next|api/auth|login|favicon.ico|robots.txt|sitemap.xml|public).*)",
  ],
};
