/** Shared context for the Beheer section pages (F25): current club + role checks. */
export function useAdminCtx() {
  const me = useMe()
  const clubFetch = useFetch('/api/clubs/current', { key: 'clubs-current' })
  const clubData = clubFetch.data
  const isAdmin = computed(() => {
    const clubId = clubData.value?.club?.id
    return !!clubId && !!me.value?.roles.adminOfClubIds.includes(clubId)
  })
  const isInstanceAdmin = computed(() => !!me.value?.roles.instanceAdmin)
  return { me, clubData, refreshClub: clubFetch.refresh, isAdmin, isInstanceAdmin }
}
