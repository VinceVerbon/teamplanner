import { z } from 'zod'
import { createError } from 'h3'
import { requireUser } from '../../utils/guards'
import { getCurrentClub } from '../../services/clubs'
import { previewTeamImport } from '../../services/voetbalnl-import'

// F30: credentials pass through in-memory to the voetbal.nl login replay and are
// never persisted or logged.
const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const club = await getCurrentClub()
  if (!club) throw createError({ statusCode: 409, statusMessage: 'No club exists yet' })
  const body = bodySchema.parse(await readBody(event))
  return previewTeamImport(me.id, club.id, club.name, { email: body.email, password: body.password })
})
