import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { updateSlot } from '../../services/trainings'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

const bodySchema = z.object({
  weekday: z.number().int().min(1).max(7).optional(),
  startTime: z.string().regex(TIME).optional(),
  endTime: z.string().regex(TIME).optional(),
  locationId: z.string().min(1).optional(),
  trainerUserId: z.string().nullish(),
  generateFrom: z.string().regex(DATE).optional()
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return updateSlot(me.id, id, body)
})
