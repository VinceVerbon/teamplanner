import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { changeOwnPassword } from '../../services/accounts'
import { assertRateLimit } from '../../utils/rate-limit'

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1)
})

/** Own-password change; also how a forced first-login change (F22/F23) is completed.
 * F31: rate-limited per user - the server-side auth.api.changePassword() call bypasses
 * better-auth's own router limiter, so the guessing cap lives here. */
export default defineEventHandler(async (event) => {
  const { id } = await requireUser(event)
  assertRateLimit(`me-password:${id}`, 5, 15 * 60 * 1000)
  const body = bodySchema.parse(await readBody(event))
  return changeOwnPassword(event.headers, body.currentPassword, body.newPassword)
})
