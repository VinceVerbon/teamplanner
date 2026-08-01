import { requireUser } from '../../utils/guards'
import { listParentLinks } from '../../services/parents'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  return listParentLinks(me.id)
})
