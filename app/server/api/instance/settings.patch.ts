import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { updateInstanceSettings } from '../../services/instance'

const bodySchema = z.object({
  dateFormat: z.enum(['DD-MM-YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),
  timeFormat: z.enum(['24h', '12h']).optional(),
  weekNumbering: z.enum(['iso', 'us']).optional()
})

/** F26: update instance settings (instance admin only). */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  return updateInstanceSettings(me.id, body)
})
