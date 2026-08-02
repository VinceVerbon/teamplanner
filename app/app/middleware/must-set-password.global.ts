// F22/F23: while the signed-in account still has mustSetPassword, every route funnels
// to the change-password page (the server blocks all other APIs anyway - this is UX).
const EXEMPT = ['/change-password', '/login', '/setup-admin', '/register']

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return
  if (EXEMPT.includes(to.path)) return
  const { data } = await authClient.getSession()
  const user = data?.user as { mustSetPassword?: boolean } | undefined
  if (user?.mustSetPassword) {
    return navigateTo('/change-password')
  }
})
