import { requireUser } from '../../../utils/guards'
import { attendanceStats } from '../../../services/attendance'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  return attendanceStats(me.id, teamId)
})
