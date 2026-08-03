import { requireUser } from '../../../utils/guards'
import { requireInstanceAdmin } from '../../../services/instance'
import { getKnvbSources } from '../../../services/knvb-sources'

/** F28 follow-up: the source set fetch/force-reload run against (configured or seed). */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  await requireInstanceAdmin(me.id)
  return getKnvbSources()
})
