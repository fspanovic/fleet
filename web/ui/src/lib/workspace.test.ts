import { describe, expect, it } from 'vitest'

import type { DeleteResponse, WorktreeInspect } from '@/api/types'
import { deletePlan, deleteToast } from '@/lib/deleteSession'
import { workspaceHandle, workspaceTooltip, worktreeChoice } from '@/lib/workspace'

const workspace = { handle: 'ballyhoo', branch: 'someone/fix-login', path: '/home/tester/fleet/workspaces/app/ballyhoo', repo: '/home/tester/Code/app', base: 'origin/main', named: true }

describe('workspace helpers', () => {
  it('the handle of a fleet-made worktree, nothing otherwise', () => {
    expect(workspaceHandle({ workspace })).toBe('ballyhoo')
    expect(workspaceHandle({ workspace: null })).toBeNull()
    expect(workspaceHandle({})).toBeNull()
    expect(workspaceHandle({ workspace: { ...workspace, handle: ' ' } })).toBeNull()
  })

  it('tooltip names the branch and where it started', () => {
    expect(workspaceTooltip({ workspace })).toBe('Worktree ballyhoo · branch someone/fix-login · from origin/main')
    expect(workspaceTooltip({})).toBe('')
  })

  it('the remembered New worktree choice is off unless it was turned on', () => {
    expect(worktreeChoice('1')).toBe(true)
    expect(worktreeChoice('0')).toBe(false)
    expect(worktreeChoice(null)).toBe(false)
    expect(worktreeChoice('true')).toBe(false)
  })
})

const inspect: WorktreeInspect = {
  host: 'laptop',
  id: 'aaaaaaaa-1',
  name: 'Fix login',
  cwd: workspace.path,
  action: 'remove-worktree',
  reason: null,
  checkout: { path: workspace.path, branch: workspace.branch, linked: true },
  worktree: {
    path: workspace.path,
    branch: workspace.branch,
    mainPath: workspace.repo,
    locked: false,
    dirty: { count: 0, files: [] },
    unpushed: { count: 0, commits: [] },
  },
  workspace: { handle: 'ballyhoo', branch: workspace.branch, deleteBranch: true },
  sessions: [],
  blocked: false,
  needsForce: false,
}

describe('deleting a workspace session', () => {
  it('says the branch fleet made goes too when nothing on it is unpushed', () => {
    expect(deletePlan(inspect).note).toMatch(/branch someone\/fix-login fleet made for it is deleted too/)
    expect(deletePlan({ ...inspect, workspace: { ...inspect.workspace!, deleteBranch: false } }).note).toMatch(/branch someone\/fix-login stays/)
    expect(deletePlan({ ...inspect, workspace: null }).note).toMatch(/stays/)
  })

  it('the toast says whether the branch was deleted', () => {
    const base: DeleteResponse = { ok: true, host: 'laptop', id: 'aaaaaaaa-1', process: 'terminated', terminal: 'tmux-session-killed', action: 'remove-worktree', reason: null, worktree: null }
    const wt = { path: workspace.path, branch: workspace.branch, removed: true, forced: false, pruned: false, error: null }
    expect(deleteToast({ ...base, worktree: { ...wt, branchDeleted: true } }, 'x').description).toMatch(/branch someone\/fix-login deleted$/)
    expect(deleteToast({ ...base, worktree: { ...wt, branchDeleted: false } }, 'x').description).toMatch(/branch someone\/fix-login kept$/)
    expect(deleteToast({ ...base, worktree: wt }, 'x').description).toMatch(/kept$/)
  })
})
