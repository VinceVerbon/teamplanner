import { z } from 'zod'
import { requireUser } from '../../../utils/guards'
import { createOneOffSession } from '../../../services/trainings'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

const bodySchema = z.object({
  date: z.string().regex(DATE),
  startTime: z.string().regex(TIME),
  endTime: z.string().regex(TIME),
  locationId: z.string().min(1),
  trainerUserId: z.string().nullish()
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return createOneOffSession(me.id, teamId, body)
})
