import { FolderGit2Icon, GitPullRequestDraftIcon, GitPullRequestIcon, MessageSquareIcon } from 'lucide-react'

import type { PullRequest, Session } from '@/api/types'
import { CornerLink } from '@/components/CornerLink'
import { MATCH_LENGTH, MiniCard, useMadrid } from '@/components/Madrid'
import { ChecksIcon, PrSessionLink } from '@/components/PrChip'
import { PrMention } from '@/components/PrMention'
import { TaskBadge } from '@/components/TaskChip'
import { useTasks } from '@/hooks/useTasks'
import { relTime } from '@/lib/format'
import { reviewLabel, ROT_TONE, waitingSince } from '@/lib/prs'
import { taskTooltip } from '@/lib/tasks'
import { PR_ROT_RING } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** A PR card (the Pull requests board, Today). Under it: the task its description links (one of your open tasks → Productive) and the sessions in its worktree. */
export function PrCard({ pr: p, now, onOpen, sessions }: { pr: PullRequest; now: number; onOpen: (p: PullRequest) => void; sessions?: Session[] }) {
  const task = useTasks().links.taskByPr.get(p.url) ?? null
  const review = reviewLabel(p)
  const mine = p.column === 'draftMine' || p.column === 'reviewMine' || p.column === 'readyToMergeMine'
  const worktree = p.local?.worktree
  const rot = p.rotting ? ROT_TONE[p.rotting] : null
  const since = waitingSince(p)
  const madrid = useMadrid()
  const booking = madrid && p.rotting && p.rotting !== 'fresh' ? (p.rotting === 'rotting' || p.rotting === 'critical' ? 'red' : 'yellow') : null
  const verdict = madrid && !p.myReview?.newCommits ? (p.reviewDecision === 'approved' ? 'goal' : p.reviewDecision === 'changesRequested' ? 'var' : null) : null
  return (
    <div
      className={cn(
        'relative rounded-[0.875rem] border border-transparent bg-float text-sm shadow-float transition-[border-color,box-shadow] duration-(--dur-base) hover:shadow-float-hover',
        p.rotting && p.rotting !== 'fresh' && PR_ROT_RING[p.rotting],
        madrid && 'madrid-fixture',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(p)}
        className="block w-full rounded-[0.875rem] px-3.5 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="mb-1 flex items-center gap-1.5 pr-9 text-xs text-muted-foreground lg:pr-7">
          {p.draft ? <GitPullRequestDraftIcon className="size-3.5 shrink-0" /> : <GitPullRequestIcon className="size-3.5 shrink-0" />}
          <span className="min-w-0 truncate font-mono">
            {p.repo}#{p.number}
          </span>
          <ChecksIcon checks={p.checks} />
          <span
            className="ml-auto shrink-0 rounded-full bg-fill px-1.5 text-3xs leading-4 font-semibold"
            title={`${madrid ? `${p.size} · ` : ''}+${p.additions} −${p.deletions} in ${p.changedFiles} files`}
          >
            {madrid ? MATCH_LENGTH[p.size] : p.size}
          </span>
          {booking ? (
            <span title={booking === 'red' ? `Sent off: waiting too long (${p.rotting})` : `Booked for time-wasting (${p.rotting})`} className="inline-flex shrink-0">
              <MiniCard tone={booking} />
            </span>
          ) : null}
          <span
            className={cn('shrink-0 tabular-nums', rot?.text)}
            title={`${since === p.createdAt ? 'Opened' : 'Mentioned'} ${new Date(since).toLocaleString()}${p.rotting && p.rotting !== 'fresh' ? ` — ${p.rotting}` : ''}`}
          >
            {relTime(since, now)}
          </span>
        </div>
        <div className="line-clamp-2 leading-snug font-semibold tracking-(--tracking-heading) text-foreground">{p.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {!mine ? <span>@{p.author}</span> : null}
          {verdict === 'goal' ? (
            <span className="madrid-verdict-goal rounded-full px-1.5 font-semibold" title="Approved">
              ¡Gol!
            </span>
          ) : verdict === 'var' ? (
            <span className="madrid-verdict-var rounded-full px-1.5 font-semibold" title="Changes requested">
              VAR: no goal
            </span>
          ) : review ? (
            <span className={cn(p.myReview?.newCommits && 'text-status-waiting')}>{review}</span>
          ) : null}
          {p.comments ? (
            <span className="inline-flex items-center gap-0.5" title={`${p.comments} comments`}>
              <MessageSquareIcon className="size-3" />
              {p.comments}
            </span>
          ) : null}
          {worktree ? (
            <span className="inline-flex min-w-0 items-center gap-0.5 text-status-busy" title={`Checked out in ${worktree}`}>
              <FolderGit2Icon className="size-3 shrink-0" />
              worktree
            </span>
          ) : null}
        </div>
      </button>
      <CornerLink href={p.url} label={`Open ${p.repo}#${p.number} on GitHub`} title="Open on GitHub" />
      {p.column === 'unseenMentions' ? <PrMention pr={p} className="border-t border-hairline px-3.5 py-2" /> : null}
      {task || sessions?.length ? (
        <div className="flex flex-col gap-0.5 border-t border-hairline px-2.5 py-1.5">
          {task ? (
            <a
              href={task.url}
              target="_blank"
              rel="noreferrer"
              title={taskTooltip(task)}
              className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full px-1.5 text-xs text-muted-foreground hover:bg-fill hover:text-foreground"
            >
              <TaskBadge task={task} />
              <span className="min-w-0 truncate">{task.title}</span>
            </a>
          ) : null}
          {sessions?.map((s) => (
            <PrSessionLink key={`${s.host}/${s.session_id}`} session={s} className="text-muted-foreground" />
          ))}
        </div>
      ) : null}
    </div>
  )
}
