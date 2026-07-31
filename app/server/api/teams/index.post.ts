import { z } from 'zod'
import { createError } from 'h3'
import { requireUser } from '../../utils/guards'
import { getCurrentClub } from '../../services/clubs'
import { createTeam } from '../../services/teams'

const bodySchema = z.object({ name: z.string() })

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const club = await getCurrentClub()
  if (!club) throw createError({ statusCode: 409, statusMessage: 'No club exists yet' })
  const body = bodySchema.parse(await readBody(event))
  return createTeam(me.id, club.id, body.name)
})
