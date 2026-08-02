import { requireUser } from '../../../utils/guards'
import { revokeInstanceAdmin } from '../../../services/instance'

/** F26: revoke an instance admin (never the last one). */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  return revokeInstanceAdmin(me.id, id)
})
