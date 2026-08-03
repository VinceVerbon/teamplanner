// F16: drives the time-based team mails. The deploy stack (F18) runs a single app
// container with no cron sidecar, so an in-process interval is the natural fit; the
// dispatcher is idempotent through the sent_notifications ledger, so a restart, an
// overlapping tick or a manual trigger can never double-mail.
//
// Disabled in tests (they call dispatchDueNotifications directly with a fixed clock)
// and switchable off in production via MAIL_DISPATCH_DISABLED.

import { dispatchDueNotifications } from '../services/notifications'

const INTERVAL_MS = 15 * 60 * 1000

export default defineNitroPlugin(() => {
  if (process.env.MAIL_DISPATCH_DISABLED === 'true') return
  if (process.env.TEAMPLANNER_DATA_DIR === 'memory') return

  let running = false
  const tick = async () => {
    if (running) return // a slow run must not overlap the next interval
    running = true
    try {
      const sent = await dispatchDueNotifications()
      const total = sent.reminder + sent['match-info'] + sent['absence-nudge']
      if (total > 0) {
        console.info(`[teamplanner] mail dispatch sent ${total} (reminder ${sent.reminder}, match-info ${sent['match-info']}, nudge ${sent['absence-nudge']})`)
      }
    } catch (err) {
      console.error('[teamplanner] mail dispatch failed', err)
    } finally {
      running = false
    }
  }

  // First pass shortly after boot so a restart catches anything missed while down.
  setTimeout(tick, 30_000).unref?.()
  setInterval(tick, INTERVAL_MS).unref?.()
})
