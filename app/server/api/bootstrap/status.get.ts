import { getRequestIP } from 'h3'
import { bootstrapStatus } from '../../services/accounts'
import { requireBootstrapToken } from '../../utils/bootstrap-token'
import { assertRateLimit } from '../../utils/rate-limit'

/**
 * F22/F31: is the first-run "set the admin password" step still open? Boolean only,
 * and no longer public: it sits behind BOOTSTRAP_TOKEN so it cannot be used as a
 * fresh-install oracle by scanners.
 */
export default defineEventHandler((event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  assertRateLimit(`bootstrap-status:${ip}`, 30, 15 * 60 * 1000)
  requireBootstrapToken(event)
  return bootstrapStatus()
})
