import { z } from 'zod'
import { createError } from 'h3'
import { requireUser } from '../../utils/guards'
import { getCurrentClub } from '../../services/clubs'
import { importTeams } from '../../services/voetbalnl-import'

const bodySchema = z.object({
  names: z.array(z.string().min(2)).min(1)
})

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const club = await getCurrentClub()
  if (!club) throw createError({ statusCode: 409, statusMessage: 'No club exists yet' })
  const body = bodySchema.parse(await readBody(event))
  return importTeams(me.id, club.id, body.names)
})
