import { requireUser } from '../../../utils/guards'
import { getTeamKalenderOptions } from '../../../services/speeldagen'

/** F28: kalender columns this team may select (club region + landelijk when flagged). */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  return getTeamKalenderOptions(me.id, teamId)
})
