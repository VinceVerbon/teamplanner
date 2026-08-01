import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { createNoTrainingPeriod } from '../../services/schedule'

const DATE = /^\d{4}-\d{2}-\d{2}$/

const bodySchema = z.object({
  teamId: z.string().nullish(),
  startDate: z.string().regex(DATE),
  endDate: z.string().regex(DATE),
  reason: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  return createNoTrainingPeriod(me.id, body)
})
