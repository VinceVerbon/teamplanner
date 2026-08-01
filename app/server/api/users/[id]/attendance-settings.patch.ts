import { z } from 'zod'
import { requireUser } from '../../../utils/guards'
import { setSelfManageOptIn } from '../../../services/parents'

const bodySchema = z.object({ selfManageOptIn: z.boolean() })

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const playerUserId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return setSelfManageOptIn(me.id, playerUserId, body.selfManageOptIn)
})
