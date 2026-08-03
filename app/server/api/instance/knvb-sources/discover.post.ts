import { requireUser } from '../../../utils/guards'
import { discoverKnvbSources } from '../../../services/knvb-sources'

/** F28 follow-up: scrape the KNVB landing page for the newest season's kalender PDF
 * links. Returns a proposal (discovered vs current); persisting is a separate,
 * admin-confirmed PUT. */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  return discoverKnvbSources(me.id)
})
