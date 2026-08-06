import { z } from 'zod'
import { getRequestIP } from 'h3'
import { setBootstrapPassword } from '../../services/accounts'
import { requireBootstrapToken } from '../../utils/bootstrap-token'
import { assertRateLimit } from '../../utils/rate-limit'

const bodySchema = z.object({
  newPassword: z.string().min(1)
})

/**
 * F22/F31: one-shot first-run password set for the seeded admin. Gated on
 * BOOTSTRAP_TOKEN (404 when unset, 401 on mismatch, timing-safe) and rate-limited
 * per IP; the service additionally hard-gates on the bootstrap state and dies (410)
 * once a password has been set.
 */
export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  assertRateLimit(`bootstrap:${ip}`, 5, 15 * 60 * 1000)
  requireBootstrapToken(event)
  const body = bodySchema.parse(await readBody(event))
  return setBootstrapPassword(body.newPassword)
})
