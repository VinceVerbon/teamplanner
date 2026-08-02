import { requireUser } from '../../../utils/guards'
import { forceReloadKalenders } from '../../../services/speeldagen'

/** F28: dump the whole speeldagenkalender model and renew it from the PDFs (instance
 * admin; the UI gates this behind a warning dialog). */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  return forceReloadKalenders(me.id)
})
