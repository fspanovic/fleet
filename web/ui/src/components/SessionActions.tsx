import { Suspense, useEffect, useState } from 'react'
import { AlertTriangleIcon, EraserIcon, FolderGit2Icon, GitBranchIcon, Link2Icon, Loader2Icon, PencilIcon, PowerIcon, ServerIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useLocation } from 'wouter'

import { api, sessionErrorMessage } from '@/api/client'
import type { Session, WorktreeInspect } from '@/api/types'
import { HostDot } from '@/components/HostBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useFleet } from '@/hooks/useFleet'
import { closeDeleteDialog, closeSessionMenu, closeTaskPicker, openDeleteDialog, openTaskPicker, useSessionActions } from '@/hooks/useSessionActions'
import { useTasks } from '@/hooks/useTasks'
import { openTitleEditor } from '@/hooks/useTitles'
import { changesSummary, deletePlan, deleteToast, deleteUnsupported, devPlan, refusedPlan } from '@/lib/deleteSession'
import { shortCwd } from '@/lib/format'
import { sessionHref, withoutSession } from '@/lib/sessions'
import { sessionKey } from '@/lib/shortcuts'
import { sessionTitle } from '@/lib/title'
import { lazyWithPreload } from '@/lib/lazy'
import { cn } from '@/lib/utils'
import { BinIcon } from '@/components/Madrid'

// The Link task picker (with cmdk) is its own chunk, see lib/lazy.ts.
const TaskLinkDialog = lazyWithPreload(() => import('@/components/TaskLinkDialog').then((m) => m.TaskLinkDialog))

/** The app-wide session context menu, Delete dialog and Link task picker (opened through hooks/useSessionActions.ts). Mount once, inside the router. */
export function SessionActions() {
  const { menu, deleting, linking } = useSessionActions()
  const { notConfigured } = useTasks()
  return (
    <>
      <DropdownMenu modal={false} open={menu != null} onOpenChange={(o) => !o && closeSessionMenu()}>
        <DropdownMenuTrigger asChild>
          <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />
        </DropdownMenuTrigger>
        {/* No focus return to the anchor: Rename focuses the title field, Delete opens a dialog. */}
        <DropdownMenuContent align="start" className="w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
          {menu ? (
            <>
              <DropdownMenuItem onSelect={() => openTitleEditor(menu.scope, sessionKey(menu.session))}>
                <PencilIcon />
                Rename
              </DropdownMenuItem>
              {notConfigured ? null : (
                <DropdownMenuItem onSelect={() => openTaskPicker(menu.session)}>
                  <Link2Icon />
                  Link task…
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => openDeleteDialog(menu.session)}>
                <BinIcon />
                Delete…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {deleting ? <DeleteSessionDialog key={sessionKey(deleting)} session={deleting} onClose={closeDeleteDialog} /> : null}
      {linking ? (
        <Suspense fallback={null}>
          <TaskLinkDialog key={sessionKey(linking)} session={linking} onClose={closeTaskPicker} />
        </Suspense>
      ) : null}
    </>
  )
}

/** Trash button on a row / card: shown on hover (pointer devices), opens the Delete dialog. */
export function DeleteSessionButton({ session, className }: { session: Session; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Delete session"
      title="Delete session…"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openDeleteDialog(session)
      }}
      className={cn(
        'hidden size-6 shrink-0 items-center justify-center rounded-md text-dimmer outline-none pointer-fine:inline-flex',
        'opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      <BinIcon className="size-3.5" />
    </button>
  )
}

type Load = { kind: 'loading' } | { kind: 'ready'; plan: WorktreeInspect } | { kind: 'unsupported' } | { kind: 'error'; message: string }

/**
 * Delete = close the session (like Close session) and remove the linked git worktree it runs in
 * (`git worktree remove`; the branch stays). The dialog shows what the session's host found:
 * the worktree and branch, its changes / unpushed commits (then only "Delete anyway" removes it),
 * other sessions in it (then it can't), or that the session is not in a linked worktree (then
 * it is only closed). Before a removal it lists the dev servers started in the worktree that are
 * stopped first and the leftovers (fe-live-env state, puma-dev hosts, watchman roots) cleaned after.
 */
function DeleteSessionDialog({ session: s, onClose }: { session: Session; onClose: () => void }) {
  const { fleet, applyFleet, refresh } = useFleet()
  const [location, navigate] = useLocation()
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = sessionTitle(s)

  useEffect(() => {
    const ctl = new AbortController()
    api
      .worktree(s.host, s.session_id, { signal: ctl.signal })
      .then((plan) => setLoad({ kind: 'ready', plan }))
      .catch((err) => {
        if (ctl.signal.aborted) return
        setLoad(deleteUnsupported(err) ? { kind: 'unsupported' } : { kind: 'error', message: sessionErrorMessage(err) })
      })
    return () => ctl.abort()
  }, [s.host, s.session_id])

  const done = () => {
    if (fleet) applyFleet(withoutSession(fleet, s.host, s.session_id))
    setTimeout(refresh, 2500)
    if (location === sessionHref(s)) navigate('/', { replace: true })
    onClose()
  }

  const run = async (how: 'delete' | 'force' | 'close') => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (how === 'close') {
        const res = await api.kill(s.host, s.session_id)
        toast.success(`Closed ${res.name || name}`, { description: 'The worktree was kept' })
      } else {
        const t = deleteToast(await api.deleteSession(s.host, s.session_id, how === 'force'), name)
        toast[t.tone](t.title, { description: t.description })
      }
      done()
    } catch (err) {
      const fresh = refusedPlan(err)
      if (fresh) setLoad({ kind: 'ready', plan: fresh })
      setError(fresh ? (err as Error).message : sessionErrorMessage(err))
      setBusy(false)
    }
  }

  const plan = load.kind === 'ready' ? deletePlan(load.plan) : null
  const wt = load.kind === 'ready' ? load.plan.worktree : null
  const summary = load.kind === 'ready' ? changesSummary(load.plan) : ''
  // Servers and leftovers matter only when the worktree is actually removed.
  const dev = load.kind === 'ready' && wt && (plan?.state === 'worktree' || plan?.state === 'force') ? devPlan(load.plan) : null

  return (
    <Dialog open onOpenChange={(o) => (o || busy ? null : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan?.state === 'close-only' || load.kind === 'unsupported' ? 'Close session?' : 'Delete session and worktree?'}</DialogTitle>
          <DialogDescription className="flex min-w-0 items-center gap-1.5">
            <HostDot host={s.host} />
            <span className="truncate">
              {name} · {s.host}
            </span>
          </DialogDescription>
        </DialogHeader>

        {load.kind === 'loading' ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Checking its worktree…
          </p>
        ) : null}
        {load.kind === 'error' ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Couldn't check the worktree</AlertTitle>
            <AlertDescription>{load.message}</AlertDescription>
          </Alert>
        ) : null}
        {load.kind === 'unsupported' ? (
          <p className="text-muted-foreground">{s.host}'s fleet server can't delete worktrees yet (update it there). The session can still be closed; its directory stays.</p>
        ) : null}

        {load.kind === 'ready' && plan ? (
          <div className="grid gap-3">
            {wt ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Worktree</dt>
                <dd className="flex min-w-0 items-center gap-1.5 font-mono text-xs leading-5" title={wt.path}>
                  <FolderGit2Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{shortCwd(wt.path, 60)}</span>
                </dd>
                <dt className="text-muted-foreground">Branch</dt>
                <dd className="flex min-w-0 items-center gap-1.5 font-mono text-xs leading-5">
                  <GitBranchIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{wt.branch ?? 'detached HEAD'}</span>
                  <span className="font-sans text-muted-foreground">kept</span>
                </dd>
              </dl>
            ) : load.plan.checkout || load.plan.cwd ? (
              <p className="truncate font-mono text-xs text-muted-foreground" title={load.plan.checkout?.path ?? load.plan.cwd ?? undefined}>
                {shortCwd(load.plan.checkout?.path ?? load.plan.cwd, 60)}
                {load.plan.checkout?.branch ? ` · ${load.plan.checkout.branch}` : ''}
              </p>
            ) : null}
            <p className="text-muted-foreground">{plan.note}</p>

            {dev && (dev.stop.length > 0 || dev.clean.length > 0 || dev.error || dev.kept) ? (
              <div className="grid gap-2">
                {dev.stop.length > 0 ? (
                  <div>
                    <p className="text-muted-foreground">Stops first (started in this worktree)</p>
                    <ul className="mt-1 grid gap-0.5 font-mono text-xs">
                      {dev.stop.map((l) => (
                        <li key={l.key} className="flex min-w-0 items-center gap-1.5" title={l.detail ?? undefined}>
                          <ServerIcon className="size-3.5 shrink-0" />
                          <span className="shrink-0">{l.text}</span>
                          {l.detail ? <span className="truncate text-dimmer">{l.detail}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {dev.error ? <p className="text-xs text-destructive">{dev.error} — no server is stopped</p> : null}
                {dev.kept ? <p className="text-xs text-dimmer">Left running: {dev.kept}</p> : null}
                {dev.clean.length > 0 ? (
                  <div>
                    <p className="text-muted-foreground">Then cleans</p>
                    <ul className="mt-1 grid gap-0.5 font-mono text-xs">
                      {dev.clean.map((l) => (
                        <li key={l.key} className="flex min-w-0 items-center gap-1.5">
                          <EraserIcon className="size-3.5 shrink-0" />
                          <span className={cn('truncate', l.detail && 'text-dimmer line-through')}>{l.text}</span>
                          {l.detail ? <span className="min-w-0 truncate font-sans text-dimmer">{l.detail}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {plan.state === 'blocked' ? (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>Other sessions are using it</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 grid gap-0.5">
                    {load.plan.sessions.map((o) => (
                      <li key={o.id ?? o.cwd} className="truncate">
                        {o.title || o.name || o.id?.slice(0, 8)} <span className="font-mono text-xs opacity-80">{shortCwd(o.cwd, 40)}</span>
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {wt && summary ? (
              <Alert variant={plan.state === 'force' ? 'destructive' : 'default'}>
                <AlertTriangleIcon />
                <AlertTitle>{summary}</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 grid gap-0.5 font-mono text-xs">
                    {wt.dirty.files.map((f) => (
                      <li key={f.path} className="truncate">
                        <span className="inline-block w-5 opacity-80">{f.status}</span>
                        {f.path}
                      </li>
                    ))}
                    {wt.dirty.count > wt.dirty.files.length ? <li className="opacity-80">+{wt.dirty.count - wt.dirty.files.length} more</li> : null}
                    {wt.unpushed.commits.map((c) => (
                      <li key={c.sha} className="truncate">
                        <span className="opacity-80">{c.sha}</span> {c.subject}
                      </li>
                    ))}
                    {wt.unpushed.count > wt.unpushed.commits.length ? <li className="opacity-80">+{wt.unpushed.count - wt.unpushed.commits.length} more commits</li> : null}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {plan?.closeOnly || load.kind === 'unsupported' ? (
            <Button variant={load.kind === 'unsupported' ? 'destructive' : 'outline'} disabled={busy} onClick={() => void run('close')}>
              <PowerIcon />
              {load.kind === 'unsupported' ? 'Close session' : 'Close session only'}
            </Button>
          ) : null}
          {plan?.confirm ? (
            <Button variant="destructive" disabled={busy} onClick={() => void run(plan.confirm!.force ? 'force' : 'delete')}>
              {busy ? <Loader2Icon className="animate-spin" /> : plan.state === 'close-only' ? <PowerIcon /> : <BinIcon />}
              {plan.confirm.label}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
