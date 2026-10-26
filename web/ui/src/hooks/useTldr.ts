// The TL;DR popover's data: a session's brief, fetched lazily (only while the popover is open),
// cached per session for a short TTL so reopening is instant, and the manual regenerate
// ("Refresh") with its generating poll. Same host-aware routes as the Details panel's brief
// (api.brief / api.regenerateBrief → /api/hosts/:host/sessions/:id/brief…).
import { useCallback, useRef, useState } from 'react'

import { api, isAbortError } from '@/api/client'
import type { Brief } from '@/api/types'
import { usePoller } from '@/hooks/usePoller'
import { recapError } from '@/lib/tldr'

/** A cached brief younger than this is shown without a GET. */
export const TLDR_CACHE_TTL_MS = 30_000
/** While a generation runs: poll this often until `generating` is false. */
export const TLDR_GENERATING_POLL_MS = 2_500
const CACHE_MAX = 200

const cache = new Map<string, { brief: Brief; at: number }>()

function remember(key: string, brief: Brief) {
  cache.delete(key)
  cache.set(key, { brief, at: Date.now() })
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
}

/** For tests: forget every cached brief. */
export function clearTldrCache() {
  cache.clear()
}

export function useTldr(host: string, id: string) {
  const key = `${host}/${id}`
  const [entry, setEntry] = useState<{ key: string; brief: Brief } | null>(() => {
    const c = cache.get(key)
    return c ? { key, brief: c.brief } : null
  })
  const brief = entry?.key === key ? entry.brief : null
  const [errorOf, setErrorOf] = useState<{ key: string; message: string } | null>(null)
  const error = errorOf?.key === key ? errorOf.message : null
  const [requesting, setRequesting] = useState(false)
  // After Refresh: the generatedAt before it (to tell "updated" from "nothing new"); null = none running.
  const [awaiting, setAwaiting] = useState<{ key: string; before: string | null } | null>(null)
  const [noteOf, setNoteOf] = useState<{ key: string; message: string } | null>(null)
  const note = noteOf?.key === key ? noteOf.message : null
  // Bumped by Refresh: a GET that started before it may still say "not generating" — drop it.
  const seq = useRef(0)

  const waiting = awaiting?.key === key
  const before = waiting ? (awaiting?.before ?? null) : null
  const generating = !!brief?.generating || waiting

  const poll = useCallback(
    async (signal: AbortSignal) => {
      const c = cache.get(key)
      if (c && !c.brief.generating && !waiting && Date.now() - c.at < TLDR_CACHE_TTL_MS) {
        setEntry({ key, brief: c.brief })
        return
      }
      const mine = seq.current
      try {
        const b = await api.brief(host, id, { signal })
        if (mine !== seq.current) return
        remember(key, b)
        setEntry({ key, brief: b })
        setErrorOf(null)
        if (waiting && !b.generating) {
          setAwaiting(null)
          if (!b.generatedAt || b.generatedAt === before) {
            setNoteOf({ key, message: 'Nothing new to summarise, or the model call failed.' })
          }
        }
      } catch (err) {
        if (isAbortError(err)) throw err
        setErrorOf({ key, message: recapError(err) })
        if (waiting) setAwaiting(null)
      }
    },
    [host, id, key, waiting, before],
  )

  // Mounted only while the popover is open: the first run is the lazy load (or the cache).
  usePoller(poll, generating ? TLDR_GENERATING_POLL_MS : TLDR_CACHE_TTL_MS)

  /** The manual (re)generate (POST …/brief/regenerate) — one model call, budget-gated by the server. */
  const refresh = async () => {
    if (requesting || generating) return
    setRequesting(true)
    setErrorOf(null)
    setNoteOf(null)
    try {
      await api.regenerateBrief(host, id)
      seq.current += 1
      setAwaiting({ key, before: brief?.generatedAt ?? null })
      if (brief) {
        const next = { ...brief, generating: true }
        remember(key, next)
        setEntry({ key, brief: next })
      }
    } catch (err) {
      setErrorOf({ key, message: recapError(err) })
    } finally {
      setRequesting(false)
    }
  }

  return { brief, error, note, generating, requesting, refresh }
}
