import type { H3Event } from 'h3'
import { createError } from 'h3'
import { auth } from './auth'

export async function requireUser(event: H3Event): Promise<{ id: string, email: string, name: string }> {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }
  return { id: session.user.id, email: session.user.email, name: session.user.name }
}
