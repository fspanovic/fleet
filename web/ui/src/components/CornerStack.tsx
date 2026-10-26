import { createContext, use, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const CornerContext = createContext<HTMLElement | null>(null)

/** How long a popup takes to glide into its new place in the stack. */
const GLIDE_MS = 550

/** Fired on a popup the stack moved; `detail` is the ms until it has settled in its new place. */
export const STACK_MOVED = 'fleet:stack-moved'

/** The bottom-left popups (Simeone above the substitution board) stack here, one above the other, instead of overlapping. */
export function BottomLeftStack({ children }: { children: ReactNode }) {
  const [corner, setCorner] = useState<HTMLDivElement | null>(null)
  useEffect(() => (corner ? glideOnChange(corner) : undefined), [corner])
  return (
    <CornerContext.Provider value={corner}>
      {children}
      <div ref={setCorner} className="pointer-events-none fixed bottom-4 left-4 z-[60] flex flex-col items-start gap-3" />
    </CornerContext.Provider>
  )
}

export function InBottomLeft({ children }: { children: ReactNode }) {
  const corner = use(CornerContext)
  return corner ? createPortal(children, corner) : null
}

/**
 * A popup coming or going moves the others in the stack: they glide to their new place (FLIP) instead of jumping.
 * It runs on `translate`, so the popups' own `transform` animations keep playing. Each moved popup gets a `STACK_MOVED`.
 */
function glideOnChange(stack: HTMLElement) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  const tops = new WeakMap<Element, number>()
  const items = () => [...stack.children].filter((el): el is HTMLElement => el instanceof HTMLElement)

  const observer = new MutationObserver(() => {
    for (const el of items()) {
      // The stack hangs from its bottom edge, so a popup's place is measured from there (resizing the window moves nothing).
      const top = el.offsetTop - stack.offsetHeight
      const was = tops.get(el)
      tops.set(el, top)
      if (was === undefined || was === top) continue
      const glide = !reduce.matches
      if (glide) {
        const dy = was - top + offsetY(el)
        el.style.transition = 'none'
        el.style.translate = `0 ${dy}px`
        void el.offsetHeight
        el.style.transition = `translate ${GLIDE_MS}ms var(--ease-out)`
        el.style.translate = '0 0'
      }
      el.dispatchEvent(new CustomEvent(STACK_MOVED, { detail: glide ? GLIDE_MS : 0 }))
    }
  })
  observer.observe(stack, { childList: true })

  const settle = (e: TransitionEvent) => {
    const el = e.target
    if (e.propertyName !== 'translate' || !(el instanceof HTMLElement) || el.parentElement !== stack) return
    el.style.removeProperty('transition')
    el.style.removeProperty('translate')
  }
  stack.addEventListener('transitionend', settle)
  stack.addEventListener('transitioncancel', settle)
  return () => {
    observer.disconnect()
    stack.removeEventListener('transitionend', settle)
    stack.removeEventListener('transitioncancel', settle)
  }
}

/** Where a popup still is mid-glide: the vertical part of its current `translate`. */
function offsetY(el: HTMLElement) {
  const t = getComputedStyle(el).translate
  if (!t || t === 'none') return 0
  return parseFloat(t.split(' ')[1] ?? '0') || 0
}
