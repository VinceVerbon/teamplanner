import { getCurrentClub } from '../../services/clubs'

export default defineEventHandler(async () => {
  const club = await getCurrentClub()
  return { club }
})
