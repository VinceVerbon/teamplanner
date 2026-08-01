import { requireUser } from '../../../utils/guards'
import { setClubLogo } from '../../../services/clubs'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const clubId = getRouterParam(event, 'id')!
  const parts = await readMultipartFormData(event)
  const file = parts?.find(p => p.name === 'logo' && p.data?.length)
  if (!file?.data || !file.type) {
    throw createError({ statusCode: 400, statusMessage: 'Upload a logo file in the "logo" field' })
  }
  return setClubLogo(me.id, clubId, { data: file.data, mime: file.type })
})
