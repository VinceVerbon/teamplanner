import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { listInvitations } from '../../services/invitations'

const querySchema = z.object({ teamId: z.string().min(1).optional() })

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const query = querySchema.parse(getQuery(event))
  return listInvitations(me.id, query.teamId)
})
