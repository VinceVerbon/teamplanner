import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { updateTeam } from '../../services/teams'

const bodySchema = z.object({ name: z.string().optional(), archived: z.boolean().optional() })

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return updateTeam(me.id, teamId, body)
})
