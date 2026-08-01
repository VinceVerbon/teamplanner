import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { listNoTrainingPeriods } from '../../services/schedule'

const querySchema = z.object({ teamId: z.string().optional() })

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const q = querySchema.parse(getQuery(event))
  return listNoTrainingPeriods(q.teamId)
})
