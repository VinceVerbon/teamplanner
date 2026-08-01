import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { requestParentLink } from '../../services/parents'

const bodySchema = z.object({
  email: z.string().email(),
  otherRole: z.enum(['parent', 'player'])
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  const link = await requestParentLink(me.id, body.email, body.otherRole)
  // Never expose the confirmation token to the requester.
  return { id: link.id, status: link.status }
})
