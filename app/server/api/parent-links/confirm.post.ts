import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { confirmParentLink } from '../../services/parents'

const bodySchema = z.object({ token: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  const link = await confirmParentLink(me.id, body.token)
  return { id: link.id, status: link.status }
})
