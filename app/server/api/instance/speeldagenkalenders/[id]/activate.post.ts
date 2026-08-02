import { requireUser } from '../../../../utils/guards'
import { activateKalender } from '../../../../services/speeldagen'

/** F28: activate a pending kalender / process its changes into the active one. */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  return activateKalender(me.id, id)
})
