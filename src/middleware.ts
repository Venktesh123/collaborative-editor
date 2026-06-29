// src/middleware.ts
// Simplified middleware - no NextAuth edge runtime issues

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that don't need auth
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/register",
  "/api/auth",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  // Security headers on all responses
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon).*)",
  ],
};