// The screens that are not a start view (the list / board / a session stay in the entry chunk), each
// its own chunk, shared by the mobile routes (App) and the desktop shell. See lib/lazy.ts.
import { lazyWithPreload } from '@/lib/lazy'

export const ClosedSessionScreen = lazyWithPreload(() => import('@/screens/ClosedSessionScreen').then((m) => m.ClosedSessionScreen))
export const JobsScreen = lazyWithPreload(() => import('@/screens/JobsScreen').then((m) => m.JobsScreen))
export const NotesScreen = lazyWithPreload(() => import('@/screens/NotesScreen').then((m) => m.NotesScreen))
export const OperatorScreen = lazyWithPreload(() => import('@/screens/OperatorScreen').then((m) => m.OperatorScreen))
export const PeltScreen = lazyWithPreload(() => import('@/screens/PeltScreen').then((m) => m.PeltScreen))
export const PrsScreen =lazyWithPreload(() => import('@/screens/PrsScreen').then((m) => m.PrsScreen))
export const SettingsScreen = lazyWithPreload(() => import('@/screens/SettingsScreen').then((m) => m.SettingsScreen))
export const SquadScreen = lazyWithPreload(() => import('@/screens/SquadScreen').then((m) => m.SquadScreen))
export const TasksScreen = lazyWithPreload(() => import('@/screens/TasksScreen').then((m) => m.TasksScreen))
export const TodayScreen = lazyWithPreload(() => import('@/screens/TodayScreen').then((m) => m.TodayScreen))
export const UsageScreen = lazyWithPreload(() => import('@/screens/UsageScreen').then((m) => m.UsageScreen))
