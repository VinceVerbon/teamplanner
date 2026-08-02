import type { H3Event } from 'h3'
import { createError } from 'h3'
import { auth } from './auth'

// F22/F23: while a password set/change is pending, the session may only reach the
// endpoints needed to complete it.
const MUST_SET_PASSWORD_ALLOWED = ['/api/me', '/api/me/password']

export async function requireUser(event: H3Event): Promise<{ id: string, email: string, name: string }> {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }
  const mustSetPassword = (session.user as { mustSetPassword?: boolean }).mustSetPassword
  const path = event.path.split('?')[0]
  if (mustSetPassword && !MUST_SET_PASSWORD_ALLOWED.includes(path!)) {
    throw createError({ statusCode: 403, statusMessage: 'Password change required before continuing' })
  }
  return { id: session.user.id, email: session.user.email, name: session.user.name }
}
