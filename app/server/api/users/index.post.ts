import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { createMemberAccount } from '../../services/accounts'

const bodySchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(1),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  mustChangePassword: z.boolean().optional()
})

/** F23: admin creates an account directly (no self-registration, no email verification). */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  return createMemberAccount(me.id, body)
})
