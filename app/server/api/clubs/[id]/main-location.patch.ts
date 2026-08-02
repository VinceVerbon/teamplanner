import { z } from 'zod'
import { requireUser } from '../../../utils/guards'
import { setMainLocation } from '../../../services/clubs'

const bodySchema = z.object({
  locationId: z.string().nullable()
})

/** F27: set/clear the club's main location (its own address); admin only. */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const clubId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return setMainLocation(me.id, clubId, body.locationId)
})
