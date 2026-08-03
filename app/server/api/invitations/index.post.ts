import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { createInvitation } from '../../services/invitations'

const bodySchema = z.object({
  teamId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['player', 'staff'])
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  return createInvitation(me.id, body.teamId, body.email, body.role)
})
