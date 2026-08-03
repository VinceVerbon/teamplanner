import { z } from 'zod'
import { requireUser } from '../../../../utils/guards'
import { importKalenderWeekends } from '../../../../services/kalender-schedule'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const bodySchema = z.object({
  dates: z.array(z.string().regex(DATE)).min(1),
  startTime: z.string().regex(TIME),
  endTime: z.string().regex(TIME).optional()
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return importKalenderWeekends(me.id, teamId, body)
})
