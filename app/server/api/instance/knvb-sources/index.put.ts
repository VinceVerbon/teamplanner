import { z } from 'zod'
import { requireUser } from '../../../utils/guards'
import { saveKnvbSources, KALENDER_REGIONS, type KalenderRegion } from '../../../services/knvb-sources'

const bodySchema = z.object({
  season: z.string().min(1),
  sources: z.array(z.object({
    region: z.enum(KALENDER_REGIONS as [KalenderRegion, ...KalenderRegion[]]),
    url: z.string().url()
  })).min(1)
})

/** F28 follow-up: persist the admin-confirmed kalender source set (replaces the set). */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  return saveKnvbSources(me.id, body.season, body.sources)
})
