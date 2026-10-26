import { Suspense, useEffect } from 'react'
import { Redirect, Route, Router, Switch } from 'wouter'

import { BottomLeftStack } from '@/components/CornerStack'
import { MadridMatch } from '@/components/MadridMatch'
import { MourinhoAlert } from '@/components/MourinhoAlert'
import { SimeoneAlert } from '@/components/SimeoneAlert'
import { Scratchpad } from '@/components/Scratchpad'
import { ScreenFallback } from '@/components/ScreenFallback'
import { SessionActions } from '@/components/SessionActions'
import { StackUi } from '@/components/stack/StackUi'
import { WaitingAlerts } from '@/components/WaitingAlerts'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DormantProvider } from '@/providers/DormantProvider'
import { FleetProvider } from '@/providers/FleetProvider'
import { PrefsProvider } from '@/providers/PrefsProvider'
import { PrsProvider } from '@/providers/PrsProvider'
import { TasksProvider } from '@/providers/TasksProvider'
import { SettingsProvider } from '@/providers/SettingsProvider'
import { SpeechProvider } from '@/providers/SpeechProvider'
import { UsageProvider } from '@/providers/UsageProvider'
import { usePreventFileNavigation } from '@/hooks/useAttach'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useTransitionHashLocation } from '@/lib/viewTransition'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { preloadLazy } from '@/lib/lazy'
import { DesktopShell } from '@/screens/DesktopShell'
import { ListScreen } from '@/screens/ListScreen'
import { SessionScreen } from '@/screens/SessionScreen'
import { ClosedSessionScreen, JobsScreen, NotesScreen, OperatorScreen, PeltScreen, PrsScreen, SettingsScreen, SquadScreen, TasksScreen, TodayScreen, UsageScreen } from '@/screens/lazy'

/**
 * Hash routing: `#/` (list), `#/s/<host>/<session_id>` (detail), `#/closed/<host>/<session_id>` (a closed / dormant session's chat, read only),
 * plus `#/settings` (this viewer's preferences), `#/usage` (the subscription limits), `#/jobs` (scheduled jobs), `#/operator` (talk to the fleet by voice), `#/prs` (the GitHub PRs that need you), `#/tasks` (your open Productive tasks), `#/today` (what needs you now) and `#/notes[/<host>[/<path>]]` (the notes explorer).
 * No server-side SPA fallback needed; the PWA start_url is `/#/`. Desktop and mobile use the
 * same routes, so links work across both.
 */
export default function App() {
  // ≥ lg: master–detail shell; below it the mobile screens, untouched. Crossing the
  // breakpoint swaps trees (the hash route is shared, so the open session stays open).
  const desktop = useIsDesktop()
  // A file dropped outside a drop zone must not navigate the app away.
  usePreventFileNavigation()
  // The screens split out of the entry chunk: fetched once the first paint is done.
  useEffect(() => preloadLazy(), [])
  return (
    <ThemeProvider>
      <PrefsProvider>
      <SettingsProvider>
      <SpeechProvider>
        <FleetProvider>
        <DormantProvider>
        <PrsProvider>
        <TasksProvider>
        <UsageProvider>
          <TooltipProvider>
            <Router hook={useTransitionHashLocation}>
              {desktop ? (
                <DesktopShell />
              ) : (
                <Suspense fallback={<ScreenFallback />}>
                <Switch>
                  <Route path="/">
                    <ListScreen />
                  </Route>
                  <Route path="/settings">
                    <SettingsScreen />
                  </Route>
                  <Route path="/usage">
                    <UsageScreen />
                  </Route>
                  <Route path="/jobs">
                    <JobsScreen />
                  </Route>
                  <Route path="/pelt">
                    <PeltScreen />
                  </Route>
                  <Route path="/operator">
                    <OperatorScreen />
                  </Route>
                  <Route path={/^\/prs(?:\/.*)?$/}>
                    <PrsScreen />
                  </Route>
                  <Route path="/tasks">
                    <TasksScreen />
                  </Route>
                  <Route path="/today">
                    <TodayScreen />
                  </Route>
                  <Route path="/squad">
                    <SquadScreen />
                  </Route>
                  <Route path={/^\/notes(?:\/.*)?$/}>
                    <NotesScreen />
                  </Route>
                  <Route path="/s/:host/:id">
                    {(p) => <SessionScreen key={`${p.host}/${p.id}`} host={p.host} id={p.id} />}
                  </Route>
                  <Route path="/closed/:host/:id">
                    {(p) => <ClosedSessionScreen key={`${p.host}/${p.id}`} host={p.host} id={p.id} />}
                  </Route>
                  <Route>
                    <Redirect to="/" replace />
                  </Route>
                </Switch>
                </Suspense>
              )}
              {/* Session stacks: the Stack sheet + Spawn sibling form, opened from rows, columns, the session screen. */}
              <StackUi />
              {/* Row / card right-click menu (Rename, Delete…) and the Delete dialog. */}
              <SessionActions />
              {/* ⌘⇧S / header buttons: the floating (desktop) or drawer (mobile) scratchpad. */}
              <Scratchpad />
              {/* A system notification + the title count when a session starts waiting on you. */}
              <WaitingAlerts desktop={desktop} />
              <MourinhoAlert />
              <BottomLeftStack>
                <SimeoneAlert />
                <MadridMatch />
              </BottomLeftStack>
            </Router>
            <Toaster position={desktop ? 'bottom-right' : 'top-center'} offset={desktop ? { bottom: 112, right: 16 } : undefined} />
          </TooltipProvider>
        </UsageProvider>
        </TasksProvider>
        </PrsProvider>
        </DormantProvider>
        </FleetProvider>
      </SpeechProvider>
      </SettingsProvider>
      </PrefsProvider>
    </ThemeProvider>
  )
}
