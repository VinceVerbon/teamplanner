import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { createSeason } from '../../services/schedule'

const DATE = /^\d{4}-\d{2}-\d{2}$/

const bodySchema = z.object({
  name: z.string().min(1),
  startDate: z.string().regex(DATE),
  endDate: z.string().regex(DATE)
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  return createSeason(me.id, body)
})
