import { z } from 'zod'
import { requireUser } from '../../../../utils/guards'
import { importMatches } from '../../../../services/matches'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

const bodySchema = z.object({
  rows: z.array(z.object({
    externalUid: z.string().nullable(),
    date: z.string().regex(DATE),
    startTime: z.string().regex(TIME),
    endTime: z.string().regex(TIME),
    opponent: z.string().min(1),
    homeAway: z.enum(['home', 'away']),
    locationText: z.string().nullable()
  })).min(1)
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return importMatches(me.id, teamId, body.rows)
})
