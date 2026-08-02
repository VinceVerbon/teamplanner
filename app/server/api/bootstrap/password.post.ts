import { z } from 'zod'
import { setBootstrapPassword } from '../../services/accounts'

const bodySchema = z.object({
  newPassword: z.string().min(1)
})

/**
 * F22: one-shot first-run password set for the seeded admin. Unauthenticated by design:
 * on a fresh install possession of the app IS the credential; the service hard-gates on
 * the bootstrap state and dies (410) once a password has been set.
 */
export default defineEventHandler(async (event) => {
  const body = bodySchema.parse(await readBody(event))
  return setBootstrapPassword(body.newPassword)
})
