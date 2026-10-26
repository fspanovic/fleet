import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/client'
import type { DeleteResponse, WorktreeInspect } from '@/api/types'
import { changesSummary, deletePlan, deleteToast, deleteUnsupported, devOutcome, devPlan, leftoverText, refusedPlan, serverText } from '@/lib/deleteSession'

const clean: WorktreeInspect = {
  host: 'laptop',
  id: 'aaaaaaaa-1',
  name: 'fix-login',
  cwd: '/home/tester/Code/worktrees/app-fix/web',
  action: 'remove-worktree',
  reason: null,
  checkout: { path: '/home/tester/Code/worktrees/app-fix', branch: 'fix', linked: true },
  worktree: {
    path: '/home/tester/Code/worktrees/app-fix',
    branch: 'fix',
    mainPath: '/home/tester/Code/app',
    locked: false,
    dirty: { count: 0, files: [] },
    unpushed: { count: 0, commits: [] },
  },
  sessions: [],
  blocked: false,
  needsForce: false,
}
const dirty: WorktreeInspect = {
  ...clean,
  worktree: { ...clean.worktree!, dirty: { count: 3, files: [{ status: 'M', path: 'a.ts' }] }, unpushed: { count: 1, commits: [{ sha: 'abc1234', subject: 'wip' }] } },
  needsForce: true,
}

describe('deletePlan', () => {
  it('a clean linked worktree: plain Delete, the branch stays', () => {
    const p = deletePlan(clean)
    expect(p.state).toBe('worktree')
    expect(p.confirm).toEqual({ label: 'Delete', force: false })
    expect(p.closeOnly).toBe(false)
    expect(p.note).toMatch(/branch fix stays/)
  })

  it('changes or unpushed commits: only an explicit forced "Delete anyway"', () => {
    const p = deletePlan(dirty)
    expect(p.state).toBe('force')
    expect(p.confirm).toEqual({ label: 'Delete anyway', force: true })
  })

  it('another session in it, or a lock: no delete, close-only offered', () => {
    const blocked = deletePlan({ ...dirty, blocked: true, sessions: [{ host: 'laptop', id: 'b', name: 'b', title: 'other', cwd: '/x', status: 'idle' }] })
    expect(blocked.state).toBe('blocked')
    expect(blocked.confirm).toBeNull()
    expect(blocked.closeOnly).toBe(true)
    expect(blocked.note).toMatch(/^1 other session runs/)
    const locked = deletePlan({ ...clean, worktree: { ...clean.worktree!, locked: true } })
    expect(locked.state).toBe('locked')
    expect(locked.confirm).toBeNull()
  })

  it('main checkout / outside git: closes only, says why', () => {
    const main = deletePlan({ ...clean, action: 'close-only', reason: 'main-checkout', worktree: null })
    expect(main.state).toBe('close-only')
    expect(main.confirm).toEqual({ label: 'Close session', force: false })
    expect(main.note).toMatch(/main checkout/)
    expect(deletePlan({ ...clean, action: 'close-only', reason: 'not-git', checkout: null, worktree: null }).note).toMatch(/not in a git repository/)
  })
})

describe('changesSummary', () => {
  it('counts both kinds, empty when clean', () => {
    expect(changesSummary(dirty)).toBe('3 uncommitted changes · 1 commit not pushed')
    expect(changesSummary(clean)).toBe('')
  })
})

describe('errors', () => {
  it('an older server (no route) can only close; an unknown session is not that', () => {
    expect(deleteUnsupported(new ApiError('not found', 404))).toBe(true)
    expect(deleteUnsupported(new ApiError('delete is not available on this server', 501))).toBe(true)
    expect(deleteUnsupported(new ApiError('unknown session: x', 404))).toBe(false)
  })

  it('a 409 refusal carries the fresh plan', () => {
    expect(refusedPlan(new ApiError('nothing closed', 409, { ...dirty, refused: 'changes' }))?.needsForce).toBe(true)
    expect(refusedPlan(new ApiError('boom', 502, { error: 'boom' }))).toBeNull()
  })
})

describe('deleteToast', () => {
  const base: DeleteResponse = { ok: true, host: 'laptop', id: 'a', name: 'fix-login', process: 'terminated', terminal: 'tmux-session-killed', action: 'remove-worktree', reason: null, worktree: null }
  it('removed / kept / close-only', () => {
    expect(deleteToast({ ...base, worktree: { path: '/home/tester/Code/worktrees/app-fix', branch: 'fix', removed: true, forced: true, pruned: false, error: null } }, 'fix-login')).toEqual({
      tone: 'success',
      title: 'Deleted fix-login',
      description: 'Removed ~/Code/worktrees/app-fix (forced) · branch fix kept',
    })
    expect(deleteToast({ ...base, worktree: { path: '/w', branch: 'fix', removed: false, forced: false, pruned: false, error: 'contains modified files' } }, 'x').tone).toBe('warning')
    expect(deleteToast({ ...base, action: 'close-only', reason: 'not-git' }, 'x').title).toBe('Closed x')
  })
})

describe('dev servers and leftovers', () => {
  const vite = { pid: 120, pgid: 120, label: 'node', command: 'node vite --port 4250', ports: [4250, 4251], pids: [120, 121], underSession: true }
  const puma = { pid: 130, pgid: null, label: 'ruby', command: null, ports: [], pids: [130], underSession: false }
  const withDev: WorktreeInspect = {
    ...clean,
    servers: {
      stop: [vite, puma],
      kept: [1, 2, 3, 4].map((i) => ({ pid: 140 + i, label: 'zsh', command: 'zsh', ports: [], via: 'tmux other' })),
      error: null,
    },
    leftovers: [
      { kind: 'fe-live-env', name: 'fix', port: 4250, keep: null },
      { kind: 'puma-dev', name: 'app-fix-4250.productive.io', port: 4250, keep: 'its fe-live-env stays' },
      { kind: 'watchman', name: '/home/tester/Code/worktrees/app-fix', port: null, keep: null },
    ],
  }

  it('serverText / leftoverText', () => {
    expect(serverText(vite)).toBe('node 120 · :4250 :4251')
    expect(serverText(puma)).toBe('ruby 130')
    expect(leftoverText({ kind: 'watchman', name: '/home/tester/Code/worktrees/app-fix' })).toBe('watchman root ~/Code/worktrees/app-fix')
    expect(leftoverText({ kind: 'puma-dev', name: 'app-x.productive.io' })).toBe('puma-dev app-x.productive.io')
  })

  it('devPlan: what is stopped, what stays, what is cleaned', () => {
    const p = devPlan(withDev)
    expect(p.stop).toEqual([
      { key: 'g120', text: 'node 120 · :4250 :4251', detail: 'node vite --port 4250' },
      { key: 'p130', text: 'ruby 130', detail: null },
    ])
    expect(p.kept).toBe('zsh 141 (tmux other), zsh 142 (tmux other), zsh 143 (tmux other), +1 more')
    expect(p.clean.map((c) => [c.text, c.detail])).toEqual([
      ['fe-live-env fix', null],
      ['puma-dev app-fix-4250.productive.io', 'kept: its fe-live-env stays'],
      ['watchman root ~/Code/worktrees/app-fix', null],
    ])
    expect(p.error).toBeNull()
  })

  it('devPlan: an older server says nothing about them', () => {
    expect(devPlan(clean)).toEqual({ stop: [], kept: null, clean: [], error: null })
  })

  const removed = { path: '/home/tester/Code/worktrees/app-fix', branch: 'fix', removed: true, forced: false, pruned: false, error: null }
  const res: DeleteResponse = { ok: true, host: 'laptop', id: 'a', name: 'fix-login', process: 'terminated', terminal: 'tmux-session-killed', action: 'remove-worktree', reason: null, worktree: removed }

  it('devOutcome + toast: what was stopped and cleaned', () => {
    const done: DeleteResponse = {
      ...res,
      servers: { stopped: [{ ...vite, result: 'terminated', error: null }, { ...puma, result: 'gone', error: null }], kept: [], error: null },
      leftovers: [
        { kind: 'fe-live-env', name: 'fix', result: 'removed', note: 'fix.json' },
        { kind: 'watchman', name: '/w', result: 'removed', note: null },
        { kind: 'puma-dev', name: 'app-fix-4250.productive.io', result: 'kept', note: 'port 4250 still has a listener' },
      ],
    }
    expect(devOutcome(done)).toEqual({ done: ['stopped 1 server', 'cleaned 2 leftovers'], problems: [] })
    expect(deleteToast(done, 'fix-login')).toEqual({
      tone: 'success',
      title: 'Deleted fix-login',
      description: 'Removed ~/Code/worktrees/app-fix · branch fix kept · stopped 1 server · cleaned 2 leftovers',
    })
  })

  it('devOutcome + toast: a server that survived or a failed cleanup makes it a warning', () => {
    const bad: DeleteResponse = {
      ...res,
      servers: { stopped: [{ ...puma, result: 'failed', error: 'operation not permitted' }], kept: [], error: null },
      leftovers: [{ kind: 'watchman', name: '/w', result: 'failed', note: 'watch-del did not confirm' }],
    }
    expect(devOutcome(bad).problems).toEqual(['ruby 130 still running (operation not permitted)', 'watchman root /w: watch-del did not confirm'])
    const t = deleteToast(bad, 'fix-login')
    expect(t.tone).toBe('warning')
    expect(t.description).toMatch(/ruby 130 still running/)
    expect(devOutcome({ ...res, servers: { stopped: [], kept: [], error: 'could not list processes: lsof' } }).problems).toEqual(['could not list processes: lsof'])
    expect(devOutcome(res)).toEqual({ done: [], problems: [] })
  })
})
