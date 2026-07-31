import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { updateClub } from '../../services/clubs'

const bodySchema = z.object({ name: z.string().optional() })

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const clubId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return updateClub(me.id, clubId, body)
})
