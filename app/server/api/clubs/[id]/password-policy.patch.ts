import { z } from 'zod'
import { requireUser } from '../../../utils/guards'
import { setPasswordPolicy } from '../../../services/clubs'

const bodySchema = z.object({
  policy: z.enum(['low', 'medium', 'strong'])
})

/** F24: set the enforced password standard (admin only; UI confirms before lowering). */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const clubId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return setPasswordPolicy(me.id, clubId, body.policy)
})
