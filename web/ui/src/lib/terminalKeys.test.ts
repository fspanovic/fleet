import { describe, expect, test } from 'vitest'

import { ApiError } from '@/api/client'
import type { Message } from '@/api/types'
import {
  bypassUnavailable,
  canRestartInPlace,
  canSwitchMode,
  inputFromKey,
  isDialogHeld,
  isDialogOpen,
  modeHeld,
  modeName,
  modeSwitchToast,
  needsTerminal,
  pushInput,
  switchLabel,
  switchTarget,
} from '@/lib/terminalKeys'

const ev = (key: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean }> = {}) => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  ...mods,
})

describe('isDialogOpen', () => {
  test('only while waiting on "dialog open"', () => {
    expect(isDialogOpen('waiting', 'dialog open')).toBe(true)
    expect(isDialogOpen('waiting', ' dialog open ')).toBe(true)
    expect(isDialogOpen('waiting', 'permission prompt')).toBe(false)
    expect(isDialogOpen('idle', 'dialog open')).toBe(false)
    expect(isDialogOpen('waiting', null)).toBe(false)
  })
})

describe('needsTerminal', () => {
  const question = { role: 'assistant', kind: 'question', id: 'q1', text: '', questions: [{ question: 'Go?', header: '', multiSelect: false, options: [] }] } as unknown as Message
  test('waiting on something the chat cannot show', () => {
    expect(needsTerminal('waiting', [])).toBe(true)
    expect(needsTerminal('waiting', null)).toBe(true)
    expect(needsTerminal('busy', [])).toBe(false)
    expect(needsTerminal('idle', [])).toBe(false)
  })
  test('not while an AskUserQuestion card takes the answer', () => {
    expect(needsTerminal('waiting', [question])).toBe(false)
    expect(needsTerminal('waiting', [{ ...question, answers: ['yes'] } as Message])).toBe(true)
  })
})

describe('isDialogHeld', () => {
  test('a 409 the server held because a dialog is open', () => {
    expect(isDialogHeld(new ApiError('held', 409, { held: 'dialog' }))).toBe(true)
    expect(isDialogHeld(new ApiError('other', 409, { held: 'waiting' }))).toBe(false)
    expect(isDialogHeld(new ApiError('nope', 404, { held: 'dialog' }))).toBe(false)
    expect(isDialogHeld(new Error('x'))).toBe(false)
  })
})

describe('inputFromKey', () => {
  test('keys Claude dialogs read', () => {
    expect(inputFromKey(ev('Escape'))).toEqual({ key: 'Escape' })
    expect(inputFromKey(ev('Enter'))).toEqual({ key: 'Enter' })
    expect(inputFromKey(ev('ArrowLeft'))).toEqual({ key: 'Left' })
    expect(inputFromKey(ev('Tab'))).toEqual({ key: 'Tab' })
    expect(inputFromKey(ev('Tab', { shiftKey: true }))).toEqual({ key: 'BTab' })
    expect(inputFromKey(ev(' '))).toEqual({ key: 'Space' })
    expect(inputFromKey(ev('Backspace'))).toEqual({ key: 'BSpace' })
    expect(inputFromKey(ev('PageDown'))).toEqual({ key: 'PageDown' })
  })
  test('printable characters are typed', () => {
    expect(inputFromKey(ev('s'))).toEqual({ text: 's' })
    expect(inputFromKey(ev('S', { shiftKey: true }))).toEqual({ text: 'S' })
    expect(inputFromKey(ev('2'))).toEqual({ text: '2' })
    expect(inputFromKey(ev('é'))).toEqual({ text: 'é' })
  })
  test('shortcuts, IME and other keys stay with the app', () => {
    expect(inputFromKey(ev('j', { metaKey: true }))).toBeNull()
    expect(inputFromKey(ev('c', { ctrlKey: true }))).toBeNull()
    expect(inputFromKey(ev('a', { altKey: true }))).toBeNull()
    expect(inputFromKey(ev('a', { isComposing: true }))).toBeNull()
    expect(inputFromKey(ev('F5'))).toBeNull()
    expect(inputFromKey(ev('Shift'))).toBeNull()
  })
})

describe('pushInput', () => {
  test('joins consecutive characters, keeps keys in order', () => {
    let q = pushInput([], { text: 'g' })
    q = pushInput(q, { text: 'i' })
    q = pushInput(q, { key: 'Down' })
    q = pushInput(q, { text: 't' })
    expect(q).toEqual([{ text: 'gi' }, { key: 'Down' }, { text: 't' }])
  })
  test('never grows one call past the limit', () => {
    expect(pushInput([{ text: 'ab' }], { text: 'c' }, 2)).toEqual([{ text: 'ab' }, { text: 'c' }])
  })
})

describe('permission mode switch', () => {
  const mode = (id: string, label = id) => ({ id, label })
  test('names and targets: bypass ↔ auto, anything else goes to bypass', () => {
    expect(modeName(mode('bypass', 'bypass permissions'))).toBe('Bypass permissions')
    expect(modeName(mode('auto', 'auto mode'))).toBe('Auto mode')
    expect(modeName(mode('something-new', 'something new'))).toBe('Something new')
    expect(modeName(null)).toBeNull()
    expect(switchTarget(mode('bypass'))).toBe('auto')
    expect(switchTarget(mode('auto'))).toBe('bypass')
    expect(switchTarget(mode('plan'))).toBe('bypass')
    expect(switchTarget(null)).toBe('bypass')
    expect(switchLabel('auto')).toBe('Switch to auto')
  })
  test('only live Claude sessions in tmux / iTerm switch; only tmux restarts in place', () => {
    expect(canSwitchMode({ harness: 'claude', backend: 'tmux' })).toBe(true)
    expect(canSwitchMode({ backend: 'iterm' })).toBe(true)
    expect(canSwitchMode({ harness: 'codex', backend: 'tmux' })).toBe(false)
    expect(canSwitchMode({ harness: 'claude', backend: 'unknown' })).toBe(false)
    expect(canSwitchMode(null)).toBe(false)
    expect(canRestartInPlace({ backend: 'tmux' })).toBe(true)
    expect(canRestartInPlace({ backend: 'iterm' })).toBe(false)
  })
  test('409 bodies: bypass not in the cycle offers a restart; waiting is held', () => {
    expect(bypassUnavailable(new ApiError('x', 409, { unavailable: 'bypass', restart: true }))).toBe(true)
    expect(bypassUnavailable(new ApiError('x', 409, { unavailable: 'auto', restart: false }))).toBe(false)
    expect(bypassUnavailable(new ApiError('x', 502, { unavailable: 'bypass', restart: true }))).toBe(false)
    expect(modeHeld(new ApiError('x', 409, { held: 'waiting' }))).toBe(true)
    expect(modeHeld(new Error('x'))).toBe(false)
  })
  test('toast copy', () => {
    expect(modeSwitchToast({ mode: mode('auto', 'auto mode'), already: false, presses: 1 })).toBe('Auto mode on (1 × ⇧Tab)')
    expect(modeSwitchToast({ mode: mode('bypass', 'bypass permissions'), already: true, presses: 0 })).toBe('Already in bypass permissions')
  })
})
