import { z } from 'zod'
import { lookupInvitation } from '../../services/invitations'

const querySchema = z.object({ token: z.string().min(1) })

// Public by design (F9): the token IS the secret and arrived in the invitee's mailbox.
// The invitee has no account yet, so this cannot sit behind requireUser.
export default defineEventHandler(async (event) => {
  const query = querySchema.parse(getQuery(event))
  return lookupInvitation(query.token)
})
