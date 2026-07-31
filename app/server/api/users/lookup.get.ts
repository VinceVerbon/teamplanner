import { createError } from 'h3'
import { requireUser } from '../../utils/guards'
import { getCurrentClub } from '../../services/clubs'
import { lookupUserByEmail } from '../../services/members'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const club = await getCurrentClub()
  if (!club) throw createError({ statusCode: 409, statusMessage: 'No club exists yet' })
  const email = String(getQuery(event).email || '')
  if (!email) throw createError({ statusCode: 400, statusMessage: 'email query parameter required' })
  const found = await lookupUserByEmail(me.id, club.id, email)
  return { user: found }
})
