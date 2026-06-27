// src/middleware.ts
// Next.js edge middleware — runs before every request.
//
// Responsibilities:
//   1. Protect API routes — return 401 for unauthenticated requests
//   2. Set security headers on all responses
//   3. CSRF-like origin check for mutation endpoints

import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that do NOT require authentication
const PUBLIC_ROUTES = new Set([
  "/api/auth/signin",
  "/api/auth/signout",
  "/api/auth/session",
  "/api/auth/csrf",
  "/api/auth/callback",
  "/api/auth/providers",
  "/login",
  "/register",
  "/",
]);

// Routes that require authentication
const PROTECTED_API_PREFIX = "/api/documents";
const PROTECTED_AI_PREFIX = "/api/ai";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // ── Security headers (applied to ALL responses) ────────────────────
  const response = NextResponse.next();

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // Next.js needs these
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' wss: https:",
      "img-src 'self' data: https:",
    ].join("; ")
  );

  // ── Origin check for mutation API routes ──────────────────────────
  const isMutation =
    req.method === "POST" ||
    req.method === "PUT" ||
    req.method === "PATCH" ||
    req.method === "DELETE";

  if (
    isMutation &&
    (pathname.startsWith(PROTECTED_API_PREFIX) ||
      pathname.startsWith(PROTECTED_AI_PREFIX))
  ) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${host}`;

    if (origin && !appUrl.includes(new URL(origin).host)) {
      return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
    }
  }

  // ── Auth guard for protected routes ───────────────────────────────
  const isPublic =
    [...PUBLIC_ROUTES].some((r) => pathname.startsWith(r)) ||
    pathname.startsWith("/api/auth/");

  if (!isPublic) {
    if (
      pathname.startsWith(PROTECTED_API_PREFIX) ||
      pathname.startsWith(PROTECTED_AI_PREFIX)
    ) {
      if (!session?.user?.id) {
        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }
    }
  }

  return response;
});

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
