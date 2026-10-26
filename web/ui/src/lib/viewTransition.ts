// Route changes through the View Transitions API (index.css `::view-transition-*`): moving to another
// screen (list → a session, → Settings, → Pull requests, …) cross-fades instead of cutting. Only
// between screens — a session to another session, a note to another note, or a query change stay
// instant, so keyboard browsing never waits on an animation. Feature-detected; skipped with reduced
// motion and in a hidden tab (where a transition would only delay the change).
import { flushSync } from 'react-dom'
import { navigate as hashNavigate, useHashLocation } from 'wouter/use-hash-location'

/** The screen a hash path belongs to: its first segment (`/s/mac/1` → `s`, `/` → ``). */
export function screenOf(path: string): string {
  return path.replace(/^#?\/?/, '').split(/[/?]/)[0] ?? ''
}

/** Whether moving from `from` to `to` changes the screen (and so deserves a transition). */
export function changesScreen(from: string, to: string): boolean {
  return screenOf(from) !== screenOf(to)
}

type NavigateOptions = Parameters<typeof hashNavigate>[1]

function canTransition(): boolean {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') return false
  if (document.visibilityState !== 'visible') return false
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** wouter's hash navigate, wrapped in a view transition when the screen changes. */
export function transitionNavigate(to: string, options?: NavigateOptions): void {
  const from = '/' + location.hash.replace(/^#?\/?/, '')
  if (!changesScreen(from, to) || !canTransition()) {
    hashNavigate(to, options)
    return
  }
  // flushSync: the new screen is committed inside the callback, so the "new" snapshot is the new screen.
  document.startViewTransition(() => flushSync(() => hashNavigate(to, options)))
}

/** The Router's location hook: wouter's hash location with transitionNavigate. */
export function useTransitionHashLocation(opts?: { ssrPath?: string }): [string, typeof transitionNavigate] {
  const [location] = useHashLocation(opts)
  return [location, transitionNavigate]
}
// Links render `#/…` hrefs, as with wouter's own hash hook (Router reads `hook.hrefs`).
useTransitionHashLocation.hrefs = (href: string) => '#' + href
