import { getInstanceSettings } from '../../services/instance'

/** F26: instance-wide format settings (public read - the app applies them everywhere). */
export default defineEventHandler(() => getInstanceSettings())
