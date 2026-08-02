import { bootstrapStatus } from '../../services/accounts'

/** F22: is the first-run "set the admin password" step still open? (public by design) */
export default defineEventHandler(() => bootstrapStatus())
