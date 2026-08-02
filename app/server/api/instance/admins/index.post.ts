import { z } from 'zod'
import { requireUser } from '../../../utils/guards'
import { grantInstanceAdmin } from '../../../services/instance'

const bodySchema = z.object({
  email: z.string().email()
})

/** F26: grant instance admin to a registered identity (instance admin only). */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  return grantInstanceAdmin(me.id, body.email)
})
