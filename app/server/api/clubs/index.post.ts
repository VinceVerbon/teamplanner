import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { createClub } from '../../services/clubs'

const bodySchema = z.object({ slug: z.string(), name: z.string() })

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  return createClub(me.id, body)
})
