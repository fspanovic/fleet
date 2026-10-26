// TL;DR popover (components/TldrButton.tsx) — pure helpers over a session brief: the short recap
// of its Summary, whether the recap is older than the session's latest activity, and the labels.
// The brief itself is the server's (docs/architecture.md → "Session briefs"); nothing here writes it.
import { ApiError, sessionErrorMessage } from '@/api/client'
import type { Brief } from '@/api/types'
import { briefTime, retryMinutes } from '@/lib/brief'

/** The recap shows at most this many sentences of the Summary… */
export const RECAP_MAX_SENTENCES = 5
/** …and at most this many characters (the rest is "More in Details"). */
export const RECAP_MAX_CHARS = 480
/** Activity this soon after the recap was written does not make it stale (the turn that ended as it ran). */
export const STALE_SLACK_MS = 60_000

/** Words ending in a dot that do not end a sentence. */
const ABBREVIATIONS = new Set(['e.g.', 'i.e.', 'etc.', 'vs.', 'cf.', 'approx.', 'incl.', 'no.', 'e.t.c.'])

/** The Summary split into sentences (whitespace and line breaks collapsed). */
export function sentences(text: string): string[] {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return []
  const out: string[] = []
  let start = 0
  const re = /[.!?]+["')\]]*\s+/g
  for (let m = re.exec(flat); m; m = re.exec(flat)) {
    const end = m.index + m[0].trimEnd().length
    const lastWord = flat.slice(start, end).split(' ').pop()?.toLowerCase() ?? ''
    // "e.g. foo", a single initial ("J. Doe"): not a boundary.
    if (ABBREVIATIONS.has(lastWord) || /^[a-z]\.$/i.test(lastWord)) continue
    out.push(flat.slice(start, end))
    start = m.index + m[0].length
  }
  if (start < flat.length) out.push(flat.slice(start))
  return out
}

/**
 * The recap: the Summary's first sentences, at most RECAP_MAX_SENTENCES and RECAP_MAX_CHARS
 * (one over-long first sentence is cut at a word boundary with "…"). `more` = something was left
 * out (the popover then points to Details).
 */
export function recap(summary: string | null | undefined, maxSentences = RECAP_MAX_SENTENCES, maxChars = RECAP_MAX_CHARS): { text: string; more: boolean } {
  const all = sentences(summary ?? '')
  if (!all.length) return { text: '', more: false }
  const kept: string[] = []
  let len = 0
  for (const s of all) {
    const next = len + (kept.length ? 1 : 0) + s.length
    if (kept.length >= maxSentences || (kept.length && next > maxChars)) break
    kept.push(s)
    len = next
  }
  let text = kept.join(' ')
  let more = kept.length < all.length
  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars)
    const space = cut.lastIndexOf(' ')
    text = `${(space > maxChars / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.—–-]+$/, '')}…`
    more = true
  }
  return { text, more }
}

/** When the Summary was last written: the model's generation, else (a hand-written brief) the last edit. */
export function recapAt(b: Pick<Brief, 'generatedAt' | 'editedAt'> | null | undefined): number | null {
  if (!b) return null
  return briefTime(b.generatedAt) ?? briefTime(b.editedAt)
}

/**
 * The recap needs a refresh: no brief / no Summary yet, or the session was active after the Summary
 * was written (by more than STALE_SLACK_MS). An unknown activity time never makes it stale.
 */
export function recapStale(
  b: (Pick<Brief, 'generatedAt' | 'editedAt'> & { parsed: Pick<Brief['parsed'], 'summary'> }) | null | undefined,
  activityAt: number | null | undefined,
): boolean {
  if (!b || !String(b.parsed?.summary ?? '').trim()) return true
  const at = recapAt(b)
  if (at == null) return true
  const act = Number(activityAt)
  if (!Number.isFinite(act) || act <= 0) return false
  return act > at + STALE_SLACK_MS
}

/** "3/5 todos" ("0/1 todo"); null when there are none. */
export function todosLabel(progress: { done: number; total: number } | null | undefined): string | null {
  if (!progress || progress.total <= 0) return null
  return `${progress.done}/${progress.total} ${progress.total === 1 ? 'todo' : 'todos'}`
}

/** "updated just now" / "updated 4 min ago" / "updated 3 h ago" / "updated 2 d ago"; null when unknown. */
export function updatedLabel(at: number | null | undefined, now = Date.now()): string | null {
  const t = Number(at)
  if (at == null || !Number.isFinite(t) || t <= 0) return null
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'updated just now'
  const m = Math.round(s / 60)
  if (m < 60) return `updated ${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `updated ${h} h ago`
  return `updated ${Math.round(h / 24)} d ago`
}

/** A failed brief GET / regenerate, in plain words (the hourly cap with its wait). */
export function recapError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const ms = (err.data as { retryAfterMs?: number } | null)?.retryAfterMs
      return `Recap limit reached, try again in ${retryMinutes(ms)} min`
    }
    if (err.status === 501) return err.message || 'Briefs are not available on this server'
    // An older server has no brief routes at all: its generic 404, not "unknown session".
    if (err.status === 404 && err.message === 'not found') return 'This host’s fleet web server predates briefs — update and restart it'
    // e.g. "transcript not found for this session" — more useful than "Session gone".
    if (err.status === 404 && err.message && !/^HTTP \d+$/.test(err.message)) return err.message
  }
  return sessionErrorMessage(err)
}
