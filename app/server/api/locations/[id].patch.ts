import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { updateLocation } from '../../services/schedule'

const bodySchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  isClubLocation: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return updateLocation(me.id, id, body)
})
