import { createContext, useContext } from 'react'

import type { AccountUsage, HostUsage } from '@/lib/usage'

export interface UsageState {
  /** Every reachable host's usage, grouped by the Claude account it is logged in to. */
  accounts: AccountUsage[]
  /** Hosts whose usage could not be read, and why. */
  errors: HostUsage[]
  loading: boolean
  /** Ask the endpoint now (skips the CLI's cache). */
  refresh: () => Promise<void>
  refreshing: boolean
}

const EMPTY: UsageState = { accounts: [], errors: [], loading: false, refresh: async () => {}, refreshing: false }

export const UsageContext = createContext<UsageState>(EMPTY)

/** The subscription usage of every account in the fleet (providers/UsageProvider.tsx). */
export const useUsage = () => useContext(UsageContext)
