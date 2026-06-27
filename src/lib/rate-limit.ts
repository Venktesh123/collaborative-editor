// src/lib/rate-limit.ts
// Sliding window rate limiter using in-memory store (swap for Redis in production)
//
// For production: replace MemoryStore with a Redis-backed store using
// `ioredis` + sliding window Lua script for atomic multi-instance safety.

import { NextRequest, NextResponse } from "next/server";

interface RateLimitEntry {
  timestamps: number[];
}

// In-memory store — NOT suitable for multi-instance deployments
// Replace with Redis in production
const store = new Map<string, RateLimitEntry>();

// Cleanup interval to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    // Remove entries with no recent timestamps
    entry.timestamps = entry.timestamps.filter((t) => now - t < 60_000);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 60_000);

export interface RateLimitConfig {
  /** Max requests allowed in the window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Key prefix for namespacing */
  prefix?: string;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number; // Unix ms timestamp when window resets
  limit: number;
}

/**
 * Sliding window rate limiter.
 *
 * @param identifier - Usually userId or IP address
 * @param config - Rate limit configuration
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const key = `${config.prefix ?? "rl"}:${identifier}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;

  const entry = store.get(key) ?? { timestamps: [] };

  // Slide the window — remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  const count = entry.timestamps.length;

  if (count >= config.limit) {
    // Calculate when the oldest request expires
    const reset = (entry.timestamps[0] ?? now) + config.windowMs;
    store.set(key, entry);
    return {
      success: false,
      remaining: 0,
      reset,
      limit: config.limit,
    };
  }

  // Record this request
  entry.timestamps.push(now);
  store.set(key, entry);

  return {
    success: true,
    remaining: config.limit - entry.timestamps.length,
    reset: now + config.windowMs,
    limit: config.limit,
  };
}

// ─────────────────────────────────────────────
// PRESET CONFIGS
// ─────────────────────────────────────────────

export const RATE_LIMITS = {
  // Sync endpoint — most sensitive, most restricted
  SYNC: { limit: 30, windowMs: 60_000, prefix: "sync" } as RateLimitConfig,

  // General document API
  DOCUMENTS: { limit: 100, windowMs: 60_000, prefix: "docs" } as RateLimitConfig,

  // Auth endpoints — prevent brute force
  AUTH: { limit: 10, windowMs: 15 * 60_000, prefix: "auth" } as RateLimitConfig,

  // AI endpoints — expensive
  AI: { limit: 20, windowMs: 60_000, prefix: "ai" } as RateLimitConfig,
} as const;

// ─────────────────────────────────────────────
// NEXT.JS MIDDLEWARE HELPER
// ─────────────────────────────────────────────

/**
 * Apply rate limiting in an API route.
 * Returns a 429 response if rate limited, otherwise null.
 */
export function applyRateLimit(
  req: NextRequest,
  identifier: string,
  config: RateLimitConfig
): NextResponse | null {
  const result = checkRateLimit(identifier, config);

  if (!result.success) {
    return NextResponse.json(
      {
        error: "Too many requests",
        retryAfter: Math.ceil((result.reset - Date.now()) / 1000),
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(result.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(result.reset),
          "Retry-After": String(Math.ceil((result.reset - Date.now()) / 1000)),
        },
      }
    );
  }

  return null;
}
