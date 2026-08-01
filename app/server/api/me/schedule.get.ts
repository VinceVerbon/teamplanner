import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { getMySchedule } from '../../services/trainings'

const querySchema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const q = querySchema.parse(getQuery(event))
  return getMySchedule(me.id, q)
})
