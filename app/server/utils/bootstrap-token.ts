import type { H3Event } from 'h3'
import { createError, getHeader, getQuery } from 'h3'
import { createHash, timingSafeEqual } from 'node:crypto'

// F31: first-run bootstrap is gated on a deploy-time secret. Possession of the app
// is no longer the credential - possession of the deploy environment is.

function digest(value: string): Buffer {
  // Hashing first makes the comparison constant-time regardless of length.
  return createHash('sha256').update(value).digest()
}

/**
 * Require a valid BOOTSTRAP_TOKEN on the request (header `x-bootstrap-token` or
 * query `token`). When the env var is not set the bootstrap routes do not exist
 * at all (404) - an instance that has completed first-run setup should keep it unset.
 */
export function requireBootstrapToken(event: H3Event): void {
  const configured = process.env.BOOTSTRAP_TOKEN
  if (!configured) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  const header = getHeader(event, 'x-bootstrap-token')
  const query = getQuery(event).token
  const provided = header ?? (typeof query === 'string' ? query : '')
  if (!timingSafeEqual(digest(provided), digest(configured))) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid bootstrap token' })
  }
}
