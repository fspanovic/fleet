import { CircleCheckIcon, CircleDotDashedIcon, CircleXIcon, GitPullRequestDraftIcon, GitPullRequestIcon, UserCheckIcon, UserSearchIcon, UserXIcon } from 'lucide-react'
import { Link, useLocation } from 'wouter'

import type { PullRequest, Session } from '@/api/types'
import { Jersey, MiniCard, useMadrid } from '@/components/Madrid'
import { StatusDot } from '@/components/StatusDot'
import { useSessionPr } from '@/hooks/usePrs'
import { useSessionTitle } from '@/hooks/useTitles'
import { CHECKS_LABEL, checksTone, prHref } from '@/lib/prs'
import { sessionHref } from '@/lib/sessions'
import { CHIP, CHIP_QUIET } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** The PR's combined CI state as a small icon (nothing when no checks report). */
export function ChecksIcon({ checks, className }: { checks: PullRequest['checks']; className?: string }) {
  const tone = checksTone(checks)
  const madrid = useMadrid()
  const icon = madrid && tone ? (
    tone === 'ok' ? (
      <img src="/madrid-ball.svg" alt="" className={cn('size-3.5', className)} />
    ) : tone === 'bad' ? (
      <MiniCard tone="red" className={className} />
    ) : (
      <span className={cn('madrid-stopwatch size-3.5 text-status-waiting', className)}>⏱</span>
    )
  ) : tone === 'ok' ? (
      <CircleCheckIcon className={cn('size-3.5 text-status-idle', className)} />
    ) : tone === 'bad' ? (
      <CircleXIcon className={cn('size-3.5 text-status-error', className)} />
    ) : tone === 'running' ? (
      <CircleDotDashedIcon className={cn('size-3.5 text-status-waiting', className)} />
    ) : null
  if (!icon) return null
  return (
    <span title={CHECKS_LABEL[tone]} aria-label={CHECKS_LABEL[tone]} className="inline-flex shrink-0">
      {icon}
    </span>
  )
}

/**
 * The PR a session works on (its cwd is the PR's worktree): `#123` + CI state. A click opens
 * the PR on the Pull requests screen — never the row it sits in (a link around it).
 */
export function PrChip({ session: s, className }: { session: Pick<Session, 'host' | 'session_id'>; className?: string }) {
  const pr = useSessionPr(s)
  const [, navigate] = useLocation()
  if (!pr) return null
  return (
    <button
      type="button"
      title={`${pr.owner}/${pr.repo}#${pr.number}: ${pr.title}`}
      aria-label={`Pull request ${pr.repo}#${pr.number}: open it`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        navigate(prHref(pr))
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className={cn(
        CHIP,
        CHIP_QUIET,
        'relative gap-0.5 tabular-nums',
        'outline-none after:absolute after:-inset-1.5 hover:bg-fill-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
    >
      <GitPullRequestIcon className="size-3 shrink-0" />#{pr.number}
      <ChecksIcon checks={pr.checks} className="size-3" />
    </button>
  )
}

const REVIEW = {
  approved: { Icon: UserCheckIcon, tone: 'text-status-idle', label: 'Approved' },
  changesRequested: { Icon: UserXIcon, tone: 'text-status-error', label: 'Changes requested' },
  reviewRequired: { Icon: UserSearchIcon, tone: 'text-dimmer', label: 'Review required' },
} as const

/**
 * A PR that links a task (My tasks): draft / open icon, `repo#123`, CI state and review decision. A click
 * opens it on the Pull requests screen, as everywhere else.
 */
export function PrLinkChip({ pr, className }: { pr: PullRequest; className?: string }) {
  const [, navigate] = useLocation()
  const review = pr.reviewDecision ? REVIEW[pr.reviewDecision] : null
  const state = [pr.draft ? 'draft' : 'open', CHECKS_LABEL[checksTone(pr.checks)].toLowerCase(), review?.label.toLowerCase()].filter(Boolean).join(', ')
  return (
    <button
      type="button"
      title={`${pr.owner}/${pr.repo}#${pr.number}: ${pr.title} (${state})`}
      aria-label={`Pull request ${pr.repo}#${pr.number}, ${state}: open it`}
      onClick={() => navigate(prHref(pr))}
      className={cn(
        CHIP,
        CHIP_QUIET,
        'max-w-full min-w-0 shrink font-normal',
        'outline-none hover:bg-fill-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
    >
      {pr.draft ? <GitPullRequestDraftIcon className="size-3 shrink-0" /> : <GitPullRequestIcon className="size-3 shrink-0 text-status-idle" />}
      <span className="min-w-0 truncate font-mono">
        {pr.repo}#{pr.number}
      </span>
      <ChecksIcon checks={pr.checks} className="size-3" />
      {review ? <review.Icon aria-hidden className={cn('size-3 shrink-0', review.tone)} /> : null}
    </button>
  )
}

/** A session working on a PR: status dot + its title, linking to it. */
export function PrSessionLink({ session: s, className }: { session: Session; className?: string }) {
  const { title } = useSessionTitle(s)
  return (
    <Link
      href={sessionHref(s)}
      className={cn('inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-xs hover:bg-muted hover:text-foreground', className)}
    >
      <StatusDot status={s.status} className="size-2" />
      <Jersey playerKey={`${s.host}/${s.session_id}`} className="size-4" />
      <span className="min-w-0 truncate">{title}</span>
    </Link>
  )
}
