import { z } from 'zod'
import { requireUser } from '../../utils/guards'
import { setParentManageOptIn } from '../../services/parents'

const bodySchema = z.object({ parentManageOptIn: z.boolean() })

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const body = bodySchema.parse(await readBody(event))
  return setParentManageOptIn(me.id, body.parentManageOptIn)
})
