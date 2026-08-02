import { requireUser } from '../../../utils/guards'
import { listInstanceAdmins } from '../../../services/instance'

/** F26: list instance admins (instance admin only). */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  return listInstanceAdmins(me.id)
})
