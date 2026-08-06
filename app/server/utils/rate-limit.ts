import { createError } from 'h3'

// F31: minimal in-memory fixed-window rate limiter for sensitive endpoints.
// Per-process by design: the deploy runs a single tp-app instance, and the
// Traefik overlay adds a coarser proxy-level limit in front of it.
const windows = new Map<string, { count: number, resetAt: number }>()

/** Count one attempt for `key`; throws 429 once `max` attempts fall inside `windowMs`. */
export function assertRateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now()
  const current = windows.get(key)
  if (!current || now >= current.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  current.count += 1
  if (current.count > max) {
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts, try again later' })
  }
}

/** Test hook: forget all windows. */
export function resetRateLimits(): void {
  windows.clear()
}
