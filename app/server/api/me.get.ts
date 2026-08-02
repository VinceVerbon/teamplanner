import { eq } from 'drizzle-orm'
import { auth } from '../utils/auth'
import { getUserRoles } from '../utils/roles'
import { getDb } from '../utils/db'
import { user } from '../db/schema'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }
  const roles = await getUserRoles(session.user.id)
  const [row] = await getDb()
    .select({
      dateOfBirth: user.dateOfBirth,
      selfManageOptIn: user.selfManageOptIn,
      parentManageOptIn: user.parentManageOptIn,
      mustSetPassword: user.mustSetPassword
    })
    .from(user).where(eq(user.id, session.user.id))
  return {
    user: session.user,
    roles,
    settings: {
      dateOfBirth: row?.dateOfBirth ?? null,
      selfManageOptIn: row?.selfManageOptIn ?? false,
      parentManageOptIn: row?.parentManageOptIn ?? false,
      mustSetPassword: row?.mustSetPassword ?? false
    }
  }
})
