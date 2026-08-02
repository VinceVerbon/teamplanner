import { z } from 'zod'
import { requireUser } from '../../../utils/guards'
import { setClubBranding } from '../../../services/clubs'

const bodySchema = z.object({
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  navPlacement: z.enum(['left', 'top', 'right']).optional()
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const clubId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return setClubBranding(me.id, clubId, body)
})
