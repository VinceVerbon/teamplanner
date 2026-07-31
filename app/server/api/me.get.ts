import { auth } from '../utils/auth'
import { getUserRoles } from '../utils/roles'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }
  const roles = await getUserRoles(session.user.id)
  return { user: session.user, roles }
})
