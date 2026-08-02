import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { changeOwnPassword } from '../../services/accounts'

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1)
})

/** Own-password change; also how a forced first-login change (F22/F23) is completed. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  return changeOwnPassword(event.headers, body.currentPassword, body.newPassword)
})
