import { getClubLogo } from '../../../services/clubs'

// Public: the club logo is the site branding (header, login page).
export default defineEventHandler(async (event) => {
  const clubId = getRouterParam(event, 'id')!
  const logo = await getClubLogo(clubId)
  if (!logo) throw createError({ statusCode: 404, statusMessage: 'No logo uploaded' })
  setHeader(event, 'Content-Type', logo.mime)
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return logo.data
})
