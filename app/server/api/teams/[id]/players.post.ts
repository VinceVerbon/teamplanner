import { z } from 'zod'
import { requireUser } from '../../../utils/guards'
import { assignPlayer } from '../../../services/members'

const bodySchema = z.object({ email: z.string().email() })

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return assignPlayer(me.id, teamId, body.email)
})
