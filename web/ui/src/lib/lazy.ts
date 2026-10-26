// Code splitting: screens and dialogs that are not on the first paint load as their own chunks
// (React.lazy), fetched on idle right after the app starts (`preloadLazy`), so opening one later
// renders in the same commit — inside the view transition — instead of flashing its fallback.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

type Loaded<T> = { default: T }

const registry = new Set<() => Promise<unknown>>()

const RELOAD_KEY = 'fleet.chunkReload'

/**
 * A chunk failed to load while rendering: a deploy replaced the build under this open page (its
 * old chunks are gone), so load the new build — once a minute at most, so a chunk that is really
 * missing still surfaces as an error. The returned promise never settles: the fallback stays up
 * until the reload.
 */
function reloadOnce(err: unknown): Promise<never> {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY))
    if (!(Date.now() - last < 60_000)) {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
      window.location.reload()
      return new Promise<never>(() => {})
    }
  } catch {
    /* no sessionStorage: surface the error */
  }
  throw err
}

/**
 * React.lazy for a named export (`() => import('@/screens/X').then((m) => m.X)`) that can be
 * fetched ahead: once loaded, React gets an already settled thenable and renders without suspending.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- React.lazy's own constraint
export function lazyWithPreload<T extends ComponentType<any>>(load: () => Promise<T>): LazyExoticComponent<T> {
  let loaded: Loaded<T> | null = null
  let pending: Promise<Loaded<T>> | null = null
  const preload = () =>
    (pending ??= load().then(
      (c) => (loaded = { default: c }),
      (err: unknown) => {
        pending = null
        throw err
      },
    ))
  registry.add(preload)
  return lazy<T>(() => {
    if (loaded) {
      const done = loaded
      return { then: (ok: (m: Loaded<T>) => void) => ok(done) } as unknown as Promise<Loaded<T>>
    }
    return preload().catch(reloadOnce)
  })
}

/** Fetch every lazy chunk once the browser is idle after the first paint (failures retry on render). */
export function preloadLazy(): () => void {
  const run = () => {
    for (const preload of registry) preload().catch(() => {})
  }
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 2000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(run, 300)
  return () => window.clearTimeout(id)
}
