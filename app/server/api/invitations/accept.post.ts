import { z } from 'zod'
import { auth } from '../../utils/auth'
import { acceptInvitationAsUser, acceptInvitationWithRegistration } from '../../services/invitations'

const bodySchema = z.object({
  token: z.string().min(1),
  registration: z.object({
    name: z.string().min(1),
    password: z.string().min(1),
    dateOfBirth: z.string().nullable().optional()
  }).optional()
})

// Public by design (F9): a logged-in user whose email matches accepts directly; a new
// user registers in place (the token proves ownership of the invited address).
export default defineEventHandler(async (event) => {
  const body = bodySchema.parse(await readBody(event))
  const session = await auth.api.getSession({ headers: event.headers })
  if (session?.user) {
    return acceptInvitationAsUser(session.user.id, body.token)
  }
  if (!body.registration) {
    throw createError({ statusCode: 400, statusMessage: 'Sign in or provide registration details to accept' })
  }
  return acceptInvitationWithRegistration(body.token, body.registration)
})
