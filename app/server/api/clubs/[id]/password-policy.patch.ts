import { z } from 'zod'
import { requireUser } from '../../../utils/guards'
import { setPasswordPolicy } from '../../../services/clubs'

const bodySchema = z.object({
  policy: z.enum(['low', 'medium', 'strong', 'custom']),
  custom: z.object({
    minLength: z.number().int().min(8).max(128),
    requireLowercase: z.boolean(),
    requireUppercase: z.boolean(),
    requireDigit: z.boolean(),
    requireSymbol: z.boolean()
  }).optional()
})

/** F24: set the enforced password standard (admin only; UI confirms before lowering). */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const clubId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return setPasswordPolicy(me.id, clubId, body.policy, body.custom)
})
