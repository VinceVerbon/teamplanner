import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { setMailSettings } from '../../services/notifications'

const bodySchema = z.object({
  mailReminders: z.boolean().optional(),
  mailChanges: z.boolean().optional(),
  mailAbsenceNudges: z.boolean().optional(),
  mailMatchInfo: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  return setMailSettings(me.id, body)
})
