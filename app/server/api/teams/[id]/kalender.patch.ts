import { z } from 'zod'
import { requireUser } from '../../../utils/guards'
import { setTeamKalender } from '../../../services/speeldagen'

const bodySchema = z.object({
  columnId: z.string().nullable()
})

/** F28: set the team's speeldagenkalender category (admin only). */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  return setTeamKalender(me.id, teamId, body.columnId)
})
