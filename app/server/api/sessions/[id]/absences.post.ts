import { z } from 'zod'
import { requireUser } from '../../../utils/guards'
import { reportAbsence } from '../../../services/attendance'

const bodySchema = z.object({
  playerUserId: z.string().min(1),
  reason: z.string().optional()
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const sessionId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return reportAbsence(me.id, sessionId, body.playerUserId, { reason: body.reason })
})
