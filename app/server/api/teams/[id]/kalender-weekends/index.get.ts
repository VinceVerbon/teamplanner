import { requireUser } from '../../../../utils/guards'
import { listKalenderWeekends } from '../../../../services/kalender-schedule'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  return listKalenderWeekends(me.id, teamId)
})
