import { requireUser } from '../../utils/guards'
import { getCurrentClub } from '../../services/clubs'
import { listTeams } from '../../services/teams'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const club = await getCurrentClub()
  if (!club) return { teams: [] }
  const includeArchived = getQuery(event).archived === '1'
  return { teams: await listTeams(club.id, { includeArchived }) }
})
