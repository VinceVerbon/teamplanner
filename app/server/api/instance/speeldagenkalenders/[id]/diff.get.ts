import { requireUser } from '../../../../utils/guards'
import { getPendingDiff } from '../../../../services/speeldagen'

/** F28: the changes a pending kalender would apply to the active one (review screen). */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  return getPendingDiff(me.id, id)
})
