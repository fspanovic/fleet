import { expect, test } from 'vitest'

import { changesScreen, screenOf } from './viewTransition'

test('screenOf: the first path segment', () => {
  expect(screenOf('/')).toBe('')
  expect(screenOf('')).toBe('')
  expect(screenOf('/s/mac/1')).toBe('s')
  expect(screenOf('#/settings')).toBe('settings')
  expect(screenOf('/notes/mac/a/b.md')).toBe('notes')
  expect(screenOf('/prs?x=1')).toBe('prs')
})

test('changesScreen: only between screens', () => {
  expect(changesScreen('/', '/s/mac/1')).toBe(true)
  expect(changesScreen('/s/mac/1', '/')).toBe(true)
  expect(changesScreen('/s/mac/1', '/settings')).toBe(true)
  expect(changesScreen('/s/mac/1', '/s/mac/2')).toBe(false)
  expect(changesScreen('/notes/mac/a.md', '/notes/mac/b.md')).toBe(false)
  expect(changesScreen('/', '/')).toBe(false)
})
