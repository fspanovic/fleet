import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { CopyIcon, NotebookPenIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useScratchpadOpen } from '@/hooks/useScratchpad'
import { copyWithToast } from '@/lib/clipboard'
import { ApiError, api, isAbortError } from '@/api/client'
import type { ScratchpadState } from '@/api/types'
import { usePoller } from '@/hooks/usePoller'
import {
  POLL_CLOSED_MS,
  POLL_OPEN_MS,
  SAVE_DELAY_MS,
  clampRect,
  defaultRect,
  loadBase,
  loadRect,
  loadText,
  mergeScratch,
  saveBase,
  saveRect,
  saveText,
  scratchpad,
  type Rect,
  type SyncBase,
} from '@/lib/scratchpad'
import { withHint } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'
import { BinIcon } from '@/components/Madrid'

/** Header / rail button that opens the scratchpad. */
export function ScratchpadButton({ className, size = 'icon' }: { className?: string; size?: 'icon' | 'icon-sm' }) {
  const open = useScratchpadOpen()
  return (
    <Button
      variant="ghost"
      size={size}
      aria-label="Scratchpad"
      aria-pressed={open}
      title={withHint('Scratchpad', 'scratchpad')}
      onClick={() => (open ? scratchpad.hide() : scratchpad.show())}
      className={cn('text-dimmer hover:text-foreground', open && 'text-foreground', className)}
    >
      <NotebookPenIcon />
    </Button>
  )
}

/**
 * The scratchpad, mounted once at the app root: a floating, non-modal panel on desktop (drag the
 * header, resize from the corner; the app stays usable under it) and a bottom drawer on mobile.
 * The text autosaves to the server (GET/PUT /api/scratchpad), localStorage is only its offline cache.
 */
export function Scratchpad() {
  const desktop = useIsDesktop()
  const open = useScratchpadOpen()
  const tick = useSyncExternalStore(scratchpad.subscribe, scratchpad.focusTick, () => 0)
  const [text, setText] = useState(loadText)
  const [saved, setSaved] = useState(true)
  const [offline, setOffline] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const pending = useRef<string | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const valueRef = useRef(text)
  const baseRef = useRef<SyncBase | null>(loadBase())
  const inflight = useRef(false)
  const again = useRef(false)
  const pendingSel = useRef<[number, number] | null>(null)

  const isDirty = () => (baseRef.current ? valueRef.current !== baseRef.current.text : valueRef.current !== '')
  const adoptBase = (b: SyncBase) => {
    baseRef.current = b
    saveBase(b)
  }
  const replaceText = (next: string) => {
    const cur = valueRef.current
    if (next === cur) return
    const el = textRef.current
    if (el && document.activeElement === el) {
      pendingSel.current =
        el.selectionStart === cur.length
          ? [next.length, next.length]
          : [Math.min(el.selectionStart, next.length), Math.min(el.selectionEnd, next.length)]
    }
    valueRef.current = next
    setText(next)
    saveText(next)
  }
  useLayoutEffect(() => {
    const sel = pendingSel.current
    if (!sel || !textRef.current) return
    pendingSel.current = null
    textRef.current.setSelectionRange(sel[0], sel[1])
  }, [text])

  const push = async (keepalive = false): Promise<void> => {
    if (inflight.current) {
      again.current = true
      return
    }
    if (!isDirty()) {
      setSaved(true)
      return
    }
    inflight.current = true
    const sent = valueRef.current
    const base = baseRef.current ?? { updatedAt: null, text: '' }
    let failed = false
    try {
      const r = await api.saveScratchpad(sent, base.updatedAt, { keepalive })
      adoptBase({ updatedAt: r.updatedAt, text: r.text })
      setOffline(false)
    } catch (err) {
      const data = err instanceof ApiError ? (err.data as Partial<ScratchpadState> | null) : null
      if (err instanceof ApiError && err.status === 409 && typeof data?.text === 'string') {
        const server = { updatedAt: data.updatedAt ?? null, text: data.text }
        const before = valueRef.current
        const merged = mergeScratch(server.text, before, base.text)
        adoptBase(server)
        replaceText(merged)
        setOffline(false)
        if (merged !== before) toast('Scratchpad changed elsewhere — merged, nothing dropped')
        again.current = true
      } else {
        failed = true
        setOffline(true)
      }
    } finally {
      inflight.current = false
    }
    if (again.current && !failed) {
      again.current = false
      return push()
    }
    again.current = false
    setSaved(!isDirty())
  }
  const pushRef = useRef(push)
  useEffect(() => {
    pushRef.current = push
  })

  const pull = async (signal: AbortSignal) => {
    let s: ScratchpadState
    try {
      s = await api.scratchpad({ signal })
    } catch (err) {
      if (!isAbortError(err)) setOffline(true)
      throw err
    }
    setOffline(false)
    if (inflight.current || pending.current != null) return
    if (isDirty()) return pushRef.current()
    const b = baseRef.current
    if (!b || b.updatedAt !== s.updatedAt || s.text !== valueRef.current) {
      adoptBase({ updatedAt: s.updatedAt, text: s.text })
      replaceText(s.text)
    }
    setSaved(true)
  }
  const refresh = usePoller(pull, open ? POLL_OPEN_MS : POLL_CLOSED_MS)

  const flush = (keepalive = false) => {
    if (pending.current == null) return
    saveText(pending.current)
    pending.current = null
    void pushRef.current(keepalive)
  }
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })

  const edit = (value: string) => {
    valueRef.current = value
    setText(value)
    pending.current = value
    setSaved(false)
  }
  useEffect(() => {
    if (saved || pending.current == null) return
    const t = setTimeout(() => flushRef.current(), SAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [text, saved])

  useEffect(() => {
    const onHide = () => flushRef.current(true)
    const onFocus = () => refresh()
    window.addEventListener('pagehide', onHide)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('focus', onFocus)
      flushRef.current(true)
    }
  }, [refresh])

  // show(): remember where focus was (Esc / close hands it back), then focus the editor.
  useEffect(() => {
    if (!open || !tick) return
    const active = document.activeElement
    if (active instanceof HTMLElement && !active.closest('[data-scratchpad]')) returnFocus.current = active
    const id = requestAnimationFrame(() => textRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, tick])
  useEffect(() => {
    if (open) return
    flushRef.current()
    const el = returnFocus.current
    returnFocus.current = null
    if (el?.isConnected && document.activeElement?.closest('[data-scratchpad]') == null) el.focus({ preventScroll: true })
  }, [open])

  const clear = () => {
    const before = text
    if (!before) return
    edit('')
    toast('Scratchpad cleared', { action: { label: 'Undo', onClick: () => edit(before) } })
    textRef.current?.focus()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      scratchpad.hide()
    }
  }

  const lines = text ? text.split('\n').length : 0
  const status = `${text.length} chars · ${lines} ${lines === 1 ? 'line' : 'lines'} · ${offline ? 'offline, kept on this device' : saved ? 'saved' : 'saving…'}`
  const toolbar = (
    <>
      <Button variant="ghost" size="icon-sm" aria-label="Copy all" title="Copy all" disabled={!text} onClick={() => void copyWithToast(text)}>
        <CopyIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Clear" title="Clear (undo from the toast)" disabled={!text} onClick={clear}>
        <BinIcon />
      </Button>
    </>
  )
  const editor = (
    <textarea
      ref={textRef}
      value={text}
      onChange={(e) => edit(e.target.value)}
      onBlur={() => flush()}
      onKeyDown={onKeyDown}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      placeholder="Paste, tweak, copy. Autosaved."
      aria-label="Scratchpad text"
      className="min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-2.5 font-mono text-body-sm leading-relaxed outline-none placeholder:text-dimmer"
    />
  )

  if (!desktop) {
    return (
      <Drawer open={open} onOpenChange={(o) => (o ? scratchpad.show() : scratchpad.hide())}>
        <DrawerContent data-scratchpad className="px-safe">
          <div className="flex items-center gap-1 border-b px-3 pb-2">
            <DrawerTitle className="flex-1 text-md">Scratchpad</DrawerTitle>
            <DrawerDescription className="sr-only">Plain text, autosaved to this host</DrawerDescription>
            {toolbar}
          </div>
          <div className="flex h-[min(60vh,calc(var(--app-h,100dvh)-8rem))] flex-col">{editor}</div>
          <div className="px-3 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-2xs text-dimmer tabular-nums">{status}</div>
        </DrawerContent>
      </Drawer>
    )
  }
  if (!open) return null
  return (
    <FloatingPanel>
      <div className="flex shrink-0 cursor-move items-center gap-1 border-b py-1 pr-1 pl-3 select-none" data-drag-handle>
        <NotebookPenIcon className="size-3.5 text-dimmer" />
        <h2 className="flex-1 text-xs font-semibold">Scratchpad</h2>
        {toolbar}
        <Button variant="ghost" size="icon-sm" aria-label="Close" title={withHint('Close (Esc)', 'scratchpad')} onClick={() => scratchpad.hide()}>
          <XIcon />
        </Button>
      </div>
      {editor}
      <div className="shrink-0 border-t px-3 py-1 text-2xs text-dimmer tabular-nums">{status}</div>
    </FloatingPanel>
  )
}

/** Fixed, draggable (by `[data-drag-handle]`), resizable from the bottom-right corner; the rect persists. */
function FloatingPanel({ children }: { children: ReactNode }) {
  const [rect, setRect] = useState<Rect>(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    return clampRect(loadRect() ?? defaultRect(vw, vh), vw, vh)
  })
  const drag = useRef<{ mode: 'move' | 'resize'; px: number; py: number; start: Rect } | null>(null)
  const rectRef = useRef(rect)
  useEffect(() => {
    rectRef.current = rect
  }, [rect])

  useLayoutEffect(() => {
    const onResize = () => setRect((r) => clampRect(r, window.innerWidth, window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const begin = (mode: 'move' | 'resize') => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    if (mode === 'move' && (e.target as HTMLElement).closest('button')) return
    if (mode === 'move' && !(e.target as HTMLElement).closest('[data-drag-handle]')) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode, px: e.clientX, py: e.clientY, start: rect }
  }
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    const next = d.mode === 'move' ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy } : { ...d.start, w: d.start.w + dx, h: d.start.h + dy }
    setRect(clampRect(next, window.innerWidth, window.innerHeight))
  }
  const end = () => {
    if (!drag.current) return
    drag.current = null
    saveRect(rectRef.current)
  }

  return (
    <section
      data-scratchpad
      aria-label="Scratchpad"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      className="fixed z-40 flex flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-overlay"
      onPointerDown={begin('move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {children}
      <div
        aria-hidden
        onPointerDown={(e) => {
          e.stopPropagation()
          begin('resize')(e)
        }}
        className="absolute right-0 bottom-0 size-4 cursor-nwse-resize"
      />
    </section>
  )
}
