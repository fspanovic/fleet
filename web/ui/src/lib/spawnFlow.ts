// After a spawn (the New session form, a task's quick start): the toast, the watch until the new
// session registers, opening it — and the New session draft that keeps a prompt nothing showed up for.
import { toast } from 'sonner'

import { watchForSpawned } from '@/api/spawnWatch'
import type { FleetResponse, Session, SpawnResponse } from '@/api/types'
import { copyText } from '@/lib/clipboard'
import { sessionHref } from '@/lib/sessions'
import { sessionKey } from '@/lib/shortcuts'
import { settleLegend, type Legend } from '@/lib/squad'
import { storage } from '@/lib/storage'

// The unsent first prompt of a plain New session (not a prefilled "continue"), so closing the form,
// a reload, a crash or a failed spawn never loses it; cleared once the started session registers. Stale after a week.
const DRAFT_KEY = 'fleet.spawnDraft'
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function loadDraft(): string {
  const d = storage.getJSON<{ prompt?: unknown; at?: unknown }>(DRAFT_KEY)
  if (!d || typeof d.prompt !== 'string' || typeof d.at !== 'number' || Date.now() - d.at > DRAFT_MAX_AGE_MS) return ''
  return d.prompt
}

export function saveDraft(prompt: string) {
  if (prompt.trim()) storage.setJSON(DRAFT_KEY, { prompt, at: Date.now() })
  else storage.remove(DRAFT_KEY)
}
/** A started session registered: drop the draft it came from (not a newer one typed since). */
export function clearDraftIf(sent: string) {
  if (loadDraft() === sent) storage.remove(DRAFT_KEY)
}

/**
 * A spawn that never showed up: its prompt becomes the draft (a "continue" / sibling one too,
 * unless a newer draft exists) and the toast offers to copy it.
 */
function notShownUp(name: string, id: string | number, sent: string) {
  const kept = sent.trim() !== ''
  if (kept && !loadDraft().trim()) saveDraft(sent)
  toast.error(`${name} has not shown up yet`, {
    id,
    description: kept ? 'Check the list in a moment. Your prompt is kept in New session.' : 'Check the list in a moment',
    ...(kept ? { action: { label: 'Copy prompt', onClick: () => void copyText(sent) } } : {}),
  })
}

export interface FollowSpawnOptions {
  /** The loading toast's title (`Starting <name> on <host>…`). */
  loading: string
  /** Who registers (`Claude`, `Codex`, …): the toast's "Waiting for … to register". */
  who: string
  /** The prompt it was started with (kept as the draft when it never shows up). */
  sent: string
  /** Every fresh fleet body (useFleet().applyFleet: the list updates too). */
  onFleet: (fleet: FleetResponse) => void
  /** Open the new session (`#/s/…`). */
  onOpenSession: (href: string) => void
  /** Before it is opened (e.g. drop the draft it came from). */
  onFound?: (s: Session) => void
  /** Madrid: the legend it was spawned as (useSquadPick), pinned to it the moment it shows up. */
  legend?: Legend | null
}

/** A spawn the server accepted: a loading toast, watch the fleet until it registers, then open it. */
export function followSpawn(spawned: Pick<SpawnResponse, 'host' | 'name' | 'tmuxSession'>, o: FollowSpawnOptions): () => void {
  const id = toast.loading(o.loading, { description: `Waiting for ${o.who} to register` })
  return watchForSpawned(spawned, {
    onFleet: o.onFleet,
    onFound: (s) => {
      settleLegend(o.legend, sessionKey(s))
      o.onFound?.(s)
      toast.success(`${spawned.name} is up`, { id, description: undefined })
      o.onOpenSession(sessionHref(s))
    },
    onTimeout: () => {
      settleLegend(o.legend)
      notShownUp(spawned.name, id, o.sent)
    },
  })
}
