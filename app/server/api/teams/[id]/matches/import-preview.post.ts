import { z } from 'zod'
import { requireUser } from '../../../../utils/guards'
import { previewMatchImport } from '../../../../services/matches'

const bodySchema = z.object({ ical: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return previewMatchImport(me.id, teamId, body.ical)
})
