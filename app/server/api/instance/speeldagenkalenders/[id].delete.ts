import { requireUser } from '../../../utils/guards'
import { discardPendingKalender } from '../../../services/speeldagen'

/** F28: cancel pending changes for now; the active kalender stays untouched. */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  return discardPendingKalender(me.id, id)
})
