import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronLeftIcon, KeyboardIcon, MonitorIcon, MoonIcon, SearchIcon, SunIcon, XIcon } from 'lucide-react'
import { useLocation } from 'wouter'

import { showMatchEvent } from '@/components/MadridMatch'
import { SQUAD } from '@/components/Madrid'
import { callMourinho } from '@/components/MourinhoAlert'
import { callSimeone } from '@/components/SimeoneAlert'
import { ReposEditor } from '@/components/ReposEditor'
import { ScreenHeader } from '@/components/ScreenHeader'
import { SpawnDirsEditor } from '@/components/SpawnDirsEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useNow } from '@/hooks/useNow'
import { usePrefs } from '@/hooks/usePrefs'
import { useSessionList } from '@/hooks/useSessionList'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import { useTheme, type ThemeChoice } from '@/hooks/useTheme'
import { notifyChannel, requestNotifyPermission, type NotifyChannel } from '@/lib/notify'
import { SEND_DELAYS, SEND_DELAY_LABELS } from '@/lib/outbox'
import { PALETTE_GROUPS, PALETTES, filterPalettes, paletteById, parsePalette, type Palette, type PaletteMode } from '@/lib/palettes'
import { TERM_FONT_SIZES, TEXT_SIZES, TEXT_SIZE_LABELS } from '@/lib/prefs'
import { shortcutHint, showShortcuts } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'

const segItem =
  'h-9 flex-1 gap-1.5 rounded-full px-3 text-body-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-seg data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_0_var(--shadow-tint-2),0_0_0_0.5px_var(--edge-strong)]'

/**
 * `#/settings`: the viewer's global preferences — text size (scales the whole app), theme
 * (colour palette), mode (light/dark), terminal text, progress notes, send delay, needs-you notifications. Stored in this browser (localStorage).
 * Plus the fleet's Start directories (the New session form's list) and Git repos (`fleet repos`), stored in each host's config. `screen` = the mobile page
 * (back button, swipe back); `pane` = the desktop main pane (✕ / Esc back to `#/`).
 */
export function SettingsScreen({ layout = 'screen' }: { layout?: 'screen' | 'pane' }) {
  const pane = layout === 'pane'
  const [, navigate] = useLocation()
  const { theme, setTheme, palette } = useTheme()
  const desktop = useIsDesktop()
  const { textSize, setTextSize, termFont, setTermFont, hideNotes, setHideNotes, sendDelay, setSendDelay } = usePrefs()

  const back = () => {
    if (!pane && window.history.length > 1) window.history.back()
    else navigate('/', { replace: !pane })
  }
  const screenRef = useRef<HTMLDivElement>(null)
  useSwipeBack(screenRef, back, !pane)

  const content = (
    <div className="mx-auto w-full max-w-lg px-gutter pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:max-w-2xl">
      <Section title="Appearance">
        <Stacked label="Text size" hint="Scales the whole app">
          <ToggleGroup
            type="single"
            value={String(textSize)}
            onValueChange={(v) => v && setTextSize(Number(v))}
            spacing={0.5}
            aria-label="Text size"
            className="w-full rounded-full bg-fill p-1"
          >
            {TEXT_SIZES.map((n) => (
              <ToggleGroupItem key={n} value={String(n)} className={segItem}>
                {TEXT_SIZE_LABELS[n] ?? `${n}px`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Stacked>
        <Stacked label="Theme" hint="Colours for the whole app: fleet’s own palettes and popular editor themes">
          <ThemePicker />
          {palette === 'madrid' ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => callMourinho()}>
                Call Mourinho
              </Button>
              <Button variant="secondary" size="sm" onClick={() => showMatchEvent({ kind: 'goal', legend: SQUAD[8], who: 'test', what: 'fleet#1 · CI green' })}>
                Score a goal
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => callMourinho({ key: 'conceded:test', headline: '“I prefer not to speak.”', who: 'fleet#1', line: 'CI failed — test gets a red card.', body: 'A test of the conceded goal' })}
              >
                Concede
              </Button>
              <Button variant="secondary" size="sm" onClick={() => showMatchEvent({ kind: 'sub', out: [{ legend: SQUAD[8], who: 'test (ended)' }], in: [{ legend: SQUAD[19], who: 'test (new)' }] })}>
                Substitution
              </Button>
              <Button variant="secondary" size="sm" onClick={() => callSimeone()}>
                Lose a session
              </Button>
            </div>
          ) : null}
        </Stacked>
        <Stacked label="Mode" hint="Light or dark; every theme has both">
          <ToggleGroup
            type="single"
            value={theme}
            onValueChange={(v) => v && setTheme(v as ThemeChoice)}
            spacing={0.5}
            aria-label="Mode"
            className="w-full rounded-full bg-fill p-1"
          >
            <ToggleGroupItem value="system" className={segItem}>
              <MonitorIcon /> System
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" className={segItem}>
              <MoonIcon /> Dark
            </ToggleGroupItem>
            <ToggleGroupItem value="light" className={segItem}>
              <SunIcon /> Light
            </ToggleGroupItem>
          </ToggleGroup>
        </Stacked>
        <Stacked label="Terminal text" hint="The terminal view; follows the text size">
          <ToggleGroup
            type="single"
            value={String(termFont)}
            onValueChange={(v) => v && setTermFont(Number(v))}
            spacing={0.5}
            aria-label="Terminal text size"
            className="w-full rounded-full bg-fill p-1"
          >
            {TERM_FONT_SIZES.map((n, i) => (
              <ToggleGroupItem key={n} value={String(n)} className={segItem}>
                {['Small', 'Default', 'Large'][i] ?? `${n}px`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Stacked>
      </Section>

      <Section title="Chat">
        <div className="flex min-h-12 items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <div className="text-sm">Progress notes</div>
            <div className="text-xs text-dimmer">Claude’s narration between tool calls</div>
          </div>
          <Switch checked={!hideNotes} onCheckedChange={(v) => setHideNotes(!v)} aria-label="Show progress notes" />
        </div>
        <Stacked label="Send delay" hint="Time to undo a message (Esc or Undo) before it goes out">
          <ToggleGroup
            type="single"
            value={String(sendDelay)}
            onValueChange={(v) => v && setSendDelay(Number(v))}
            spacing={0.5}
            aria-label="Send delay"
            className="w-full rounded-full bg-fill p-1"
          >
            {SEND_DELAYS.map((ms) => (
              <ToggleGroupItem key={ms} value={String(ms)} className={segItem}>
                {SEND_DELAY_LABELS[ms]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Stacked>
      </Section>

      <Section title="Notifications">
        <NotifySetting />
      </Section>

      {desktop ? (
        <Section title="Keyboard">
          <div className="flex min-h-12 items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="text-sm">Keyboard shortcuts</div>
              <div className="text-xs text-dimmer">
                Jump to a session with <Kbd>{shortcutHint('palette')}</Kbd>, every shortcut with <Kbd>{shortcutHint('help')}</Kbd>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={showShortcuts}>
              <KeyboardIcon /> Show
            </Button>
          </div>
        </Section>
      ) : null}

      <p className="px-1 pt-1 text-xs text-dimmer">Saved in this browser; every session uses them.</p>
      <Section title="Start directories" card={false}>
        <SpawnDirsEditor />
      </Section>
      <Section title="Git repos" card={false}>
        <ReposEditor />
      </Section>
      <FleetStatus />
      <ViewportInfo />
    </div>
  )

  if (pane) {
    return (
      <section aria-label="Settings" className="flex h-full min-w-0 flex-1 flex-col bg-background">
        <header
          data-tauri-drag-region="deep"
          className="titlebar titlebar-lead flex shrink-0 items-center gap-1 py-2.5 pr-3 pl-6 [--titlebar-pad:1.5rem]"
        >
          <h1 className="min-w-0 flex-1 text-xl leading-tight font-bold tracking-(--tracking-display)">Settings</h1>
          <Button variant="ghost" size="icon" aria-label="Close settings" title="Close (Esc)" onClick={back} className="size-9 shrink-0 rounded-full text-muted-foreground">
            <XIcon className="size-[1.125rem]" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      </section>
    )
  }

  return (
    <div ref={screenRef} className="flex min-h-app flex-col bg-background">
      <ScreenHeader>
        <div className="-ml-2 flex min-h-8 items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={back} className="-my-1.5 size-11 shrink-0 rounded-full">
            <ChevronLeftIcon className="size-6" />
          </Button>
          <h1 className="text-2xl font-bold tracking-(--tracking-display)">Settings</h1>
        </div>
      </ScreenHeader>
      {content}
    </div>
  )
}

/**
 * Theme (colour palette) picker: a radio group of swatches in sections (Fleet, Editor themes), each
 * previewing that palette's page / card / primary in the current mode. Arrow keys move between them
 * (radix roving focus, across sections). The filter above narrows by name / hint: ↓ moves into the
 * grid, Enter picks the first match, Esc clears it.
 */
function ThemePicker() {
  const { palette, setPalette, resolved } = useTheme()
  const [query, setQuery] = useState('')
  const gridRef = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => filterPalettes(query), [query])
  const sections = PALETTE_GROUPS.map((g) => ({ ...g, items: shown.filter((p) => p.group === g.id) })).filter((g) => g.items.length)
  const current = paletteById(palette)

  const focusGrid = () => {
    const root = gridRef.current
    const target = root?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? root?.querySelector<HTMLElement>('[role="radio"]')
    target?.focus()
  }
  const onFilterKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusGrid()
    } else if (e.key === 'Enter' && shown[0]) {
      e.preventDefault()
      setPalette(shown[0].id)
    } else if (e.key === 'Escape' && query) {
      // Clear first; a second Esc leaves the field (DesktopShell's blur).
      e.preventDefault()
      e.stopPropagation()
      setQuery('')
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-dimmer" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onFilterKey}
          placeholder={`Filter ${PALETTES.length} themes`}
          aria-label="Filter themes"
          autoComplete="off"
          spellCheck={false}
          className="h-9 pl-8"
        />
      </div>
      {sections.length ? (
        <div ref={gridRef}>
          <ToggleGroup
            type="single"
            value={palette}
            onValueChange={(v) => v && setPalette(parsePalette(v))}
            aria-label="Theme"
            className="w-full flex-col items-stretch gap-3"
          >
            {sections.map((g) => (
              <div key={g.id} className="space-y-1.5">
                <div className="text-2xs font-medium text-dimmer">
                  {g.label} <span className="tabular-nums">· {g.items.length}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {g.items.map((p) => (
                    <ThemeSwatch key={p.id} palette={p} mode={resolved} />
                  ))}
                </div>
              </div>
            ))}
          </ToggleGroup>
        </div>
      ) : (
        <p className="py-2 text-xs text-dimmer">No theme matches “{query.trim()}”.</p>
      )}
      <p className="text-xs text-dimmer">
        <span className="text-muted-foreground">{current.label}</span> · {current.hint}
      </p>
    </div>
  )
}

function ThemeSwatch({ palette: p, mode }: { palette: Palette; mode: PaletteMode }) {
  const sw = p.swatch[mode]
  return (
    <ToggleGroupItem
      value={p.id}
      title={p.hint}
      className="h-auto min-w-0 flex-col items-stretch gap-1.5 rounded-2xl bg-fill-hover p-1.5 pb-1 text-body-sm font-normal text-muted-foreground transition-[background-color,box-shadow] hover:bg-fill aria-checked:bg-primary/10 aria-checked:font-medium aria-checked:text-foreground aria-checked:ring-2 aria-checked:ring-primary/60 data-[state=on]:bg-primary/10"
    >
      <span
        aria-hidden
        className="flex h-12 flex-col justify-between rounded-xl p-1.5 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
        style={{ background: sw.background }}
      >
        <span className="h-3 rounded-sm" style={{ background: sw.card }} />
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-7 rounded-full" style={{ background: sw.primary }} />
          <span className="h-1.5 flex-1 rounded-full opacity-60" style={{ background: sw.card }} />
        </span>
      </span>
      <span className="truncate text-center">{p.label}</span>
    </ToggleGroupItem>
  )
}

/** A titled group of settings: rows on one inset card (`card`, the default), or — for the editors that draw their own
 *  cards and grids — straight on the page. */
function Section({ title, children, card = true }: { title: string; children: ReactNode; card?: boolean }) {
  return (
    <section className="py-2.5">
      <h2 className="px-1.5 pt-4 pb-2.5 text-2xs font-semibold tracking-[0.08em] text-dimmer uppercase">{title}</h2>
      <div className={card ? 'divide-y divide-hairline rounded-[1.25rem] bg-card px-5 shadow-float' : undefined}>{children}</div>
    </section>
  )
}

function Stacked({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2 py-3">
      <div>
        <div className="text-sm">{label}</div>
        {hint ? <div className="text-xs text-dimmer">{hint}</div> : null}
      </div>
      {children}
    </div>
  )
}

const CHANNEL_NOTE: Record<NotifyChannel, string> = {
  native: 'Fleet.app shows them in Notification Center; a click opens the session',
  browser: 'This browser shows them; a click opens the session',
  ask: 'This browser needs your permission first',
  blocked: 'Blocked in this browser’s site settings — the tab title still counts them',
  none: 'This browser can’t show them — the tab title still counts them',
}

/** Needs-you notifications (lib/notify.ts): the toggle (default on) and what this viewer can show. */
function NotifySetting() {
  const { notifyWaiting, setNotifyWaiting } = usePrefs()
  const [channel, setChannel] = useState<NotifyChannel>(() => notifyChannel())
  const ask = () => void requestNotifyPermission().then(setChannel)
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-sm">When a session needs you</div>
        <div className="text-xs text-dimmer">{notifyWaiting ? CHANNEL_NOTE[channel] : 'Off: only the count in the title'}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {notifyWaiting && channel === 'ask' ? (
          <Button variant="outline" size="sm" onClick={ask}>
            Allow
          </Button>
        ) : null}
        <Switch
          checked={notifyWaiting}
          onCheckedChange={(v) => {
            setNotifyWaiting(v)
            if (v && channel === 'ask') ask()
          }}
          aria-label="Notify when a session needs you"
        />
      </div>
    </div>
  )
}

const PROBES = ['100vh', '100lvh', '100svh', '100dvh', 'var(--app-h)'] as const

/** Viewport numbers (for layout bugs on phones / home-screen apps): what the browser reports. */
function ViewportInfo() {
  const [lines, setLines] = useState<string[]>([])
  const [outline, setOutline] = useState(false)
  useEffect(() => {
    const measure = () => {
      const probe = (css: Partial<CSSStyleDeclaration>) => {
        const el = document.createElement('div')
        Object.assign(el.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none', left: '0', top: '0', width: '1px' }, css)
        document.body.appendChild(el)
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        el.remove()
        return { h: Math.round(r.height), top: Math.round(r.top), cs }
      }
      const inset = probe({ bottom: '0' })
      const safe = probe({ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', height: '0' }).cs
      const vv = window.visualViewport
      const nav = navigator as Navigator & { standalone?: boolean }
      setLines([
        `standalone ${nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches}`,
        `screen ${screen.width}×${screen.height} · dpr ${window.devicePixelRatio}`,
        `inner ${window.innerWidth}×${window.innerHeight} · client ${document.documentElement.clientHeight}`,
        `visualViewport ${vv ? `${Math.round(vv.height)} @${Math.round(vv.offsetTop)}` : '—'}`,
        `fixed inset-0 ${inset.h} @${inset.top}`,
        ...PROBES.map((v) => `${v} ${probe({ height: v }).h}`),
        `safe top ${safe.paddingTop} · bottom ${safe.paddingBottom}`,
      ])
    }
    measure()
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [])
  return (
    <details className="pt-4 text-xs text-dimmer">
      <summary className="cursor-pointer">Viewport diagnostics</summary>
      <pre className="pt-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap">{lines.join('\n')}</pre>
      <label className="flex items-center gap-2 pt-1">
        <Switch checked={outline} onCheckedChange={setOutline} aria-label="Show viewport outlines" />
        Outlines: red = fixed inset-0, blue = app height
      </label>
      {outline ? (
        <>
          <div aria-hidden className="pointer-events-none fixed inset-0 z-[100] border-4 border-red-500" />
          <div aria-hidden className="pointer-events-none fixed inset-x-6 top-0 z-[100] h-app border-4 border-blue-500" />
        </>
      ) : null}
    </details>
  )
}

/** Connection status: how fresh the list is and which hosts answer (the list header only shows a ⚠ on trouble). */
function FleetStatus() {
  const now = useNow(5_000)
  const { note, hosts } = useSessionList(now)
  return (
    <Section title="Status">
      <div className="flex min-h-12 items-center justify-between gap-3 py-2">
        <div className="text-sm">Session list</div>
        <div className={cn('text-right text-xs tabular-nums', note.error ? 'text-destructive' : 'text-dimmer')} aria-live="polite">
          {note.text || '—'}
        </div>
      </div>
      {hosts.map((h) => (
        <div key={h.name} className="flex min-h-12 items-center justify-between gap-3 py-2">
          <div className="text-sm">{h.name}</div>
          <div className={cn('min-w-0 truncate text-right text-xs', h.ok === false ? 'text-destructive' : 'text-dimmer')}>
            {h.ok === false ? `unreachable: ${h.error || 'no response'}` : `${h.sessions?.length ?? 0} sessions`}
          </div>
        </div>
      ))}
    </Section>
  )
}
