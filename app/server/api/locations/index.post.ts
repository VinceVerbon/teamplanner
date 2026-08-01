import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { createLocation } from '../../services/schedule'

const bodySchema = z.object({
  name: z.string().min(1),
  address: z.string().optional()
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  return createLocation(me.id, body)
})
