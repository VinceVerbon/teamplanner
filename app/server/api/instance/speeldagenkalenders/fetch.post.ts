import { requireUser } from '../../../utils/guards'
import { fetchKalenders } from '../../../services/speeldagen'

/** F28: fetch + parse all KNVB speeldagenkalender PDFs (instance admin). Regions with
 * an active kalender come back as a diff to review instead of being overwritten. */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  return fetchKalenders(me.id)
})
