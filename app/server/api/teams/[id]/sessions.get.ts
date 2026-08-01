import { z } from 'zod'
import { requireUser } from '../../../utils/guards'
import { listTeamSessions } from '../../../services/trainings'

const querySchema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  const q = querySchema.parse(getQuery(event))
  return listTeamSessions(me.id, teamId, q)
})
