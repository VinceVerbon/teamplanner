interface MeResponse {
  user: { id: string, name: string, email: string, emailVerified: boolean }
  roles: {
    adminOfClubIds: string[]
    staffTeamIds: string[]
    pendingStaffTeamIds: string[]
    playerTeamId: string | null
    parentOfUserIds: string[]
  }
}

/** Session user + roles from /api/me; null while logged out. Shared app-wide. */
export function useMe() {
  return useState<MeResponse | null>('me', () => null)
}

export async function refreshMe(): Promise<void> {
  const me = useMe()
  try {
    me.value = await $fetch<MeResponse>('/api/me')
  } catch {
    me.value = null
  }
}
