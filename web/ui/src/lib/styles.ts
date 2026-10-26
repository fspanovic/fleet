// Static Tailwind class maps (tokens in index.css) — kept out of component files so
// Fast Refresh works and Tailwind sees every class name literally.
import type { StatusKey } from '@/lib/sessions'
import { hostColorSlot, type CtxLevel } from '@/lib/format'

export const STATUS_DOT: Record<StatusKey, string> = {
  waiting: 'bg-status-waiting ring-3 ring-status-waiting/20',
  busy: 'bg-status-busy',
  idle: 'bg-status-idle',
  unknown: 'bg-status-unknown',
}

/** On top of the idle dot when a background task runs (`shell`): a soft halo in the busy colour. */
export const STATUS_DOT_BACKGROUND = 'ring-2 ring-status-busy/45'
// A dot eases into its new colour when the status changes.
export const STATUS_DOT_MOTION = 'transition-[background-color,box-shadow] duration-(--dur-slow) ease-standard'

// A row / card title's minimum width, so chips (host, session style) and a long waiting reason never squeeze it to
// nothing: on a list row what doesn't fit beside it wraps to a second line (the status label truncates there, its
// full text on hover); a board card's status label sits on its own line already.
export const TITLE_MIN = 'min-w-[min(7rem,40%)]'

// Inside a washed session header (index.css [data-wash]) a status label takes the colour pulled toward the ink, so it
// holds its contrast on the wash; everywhere else `--tone-status-*` is unset and it is the plain status colour.
export const STATUS_TEXT: Record<StatusKey, string> = {
  waiting: 'text-[color:var(--tone-status-waiting,var(--status-waiting))]',
  busy: 'text-[color:var(--tone-status-busy,var(--status-busy))]',
  idle: 'text-[color:var(--tone-status-idle,var(--status-idle))]',
  unknown: 'text-status-unknown',
}

// Session cards (no colour of their own: the selected state is their only accent).
// List rows (ROW_*): flat items on the page / panel — no resting edge or fill; under the pointer a soft rounded fill;
// selected: a primary tint with a subtle inset ring. Board cards (CARD_*): a surface floating on its lane with a soft
// shadow and no outline; under the pointer it lifts (shadow + a 1px rise, motion-safe only). The keyboard cursor: a
// primary ring. `transition-*` eases between them (index.css motion tokens).
// Both sit on their own surface (`bg-session`) with a hairline edge (`border-session-edge`, >= 1.5:1 against the frame /
// page), so every session reads as a card. Inside, SESSION_CARD_TEXT lifts the quiet text to >= 4.5:1 on that surface:
// muted text is pulled 40% toward the ink and the meta line's dimmer takes that too, and status labels (STATUS_TEXT / CTX_TEXT read --tone-status-*) take
// the status colour pulled toward the ink — the status dot keeps the plain colour.
export const SESSION_CARD_TEXT =
  '[--card-muted:color-mix(in_oklab,var(--muted-foreground),var(--foreground)_50%)] [--dimmer:var(--card-muted)] [&>*]:[--muted-foreground:var(--card-muted)] [--tone-status-waiting:color-mix(in_oklab,var(--status-waiting),var(--foreground)_50%)] [--tone-status-busy:color-mix(in_oklab,var(--status-busy),var(--foreground)_45%)] [--tone-status-idle:color-mix(in_oklab,var(--status-idle),var(--foreground)_50%)] [--tone-status-unknown:var(--card-muted)]'
export const ROW_SURFACE =
  'border border-session-edge bg-session shadow-xs transition-[background-color,border-color,box-shadow,opacity] duration-(--dur-base) ease-standard hover:bg-session-hover active:bg-session-hover'
export const ROW_SELECTED =
  'border-primary bg-[color-mix(in_oklab,var(--primary)_8%,var(--color-session))] ring-1 ring-inset ring-primary shadow-[0_6px_14px_-8px_color-mix(in_oklab,var(--primary)_70%,transparent)] hover:bg-[color-mix(in_oklab,var(--primary)_10%,var(--color-session))] dark:bg-[color-mix(in_oklab,var(--primary)_11%,var(--color-session))]'
export const CARD_SURFACE =
  'border border-session-edge bg-session shadow-float transition-[background-color,border-color,box-shadow,opacity] duration-(--dur-base) ease-standard hover:bg-session-hover hover:shadow-float-hover'
export const CARD_SELECTED =
  'border-primary bg-[color-mix(in_oklab,var(--primary)_8%,var(--color-session))] ring-1 ring-inset ring-primary shadow-[0_6px_14px_-8px_color-mix(in_oklab,var(--primary)_70%,transparent)] hover:bg-[color-mix(in_oklab,var(--primary)_10%,var(--color-session))] dark:bg-[color-mix(in_oklab,var(--primary)_11%,var(--color-session))]'
export const CARD_CURSOR = 'border-primary/70 ring-1 ring-inset ring-primary/50'
export const ROW_CURSOR = 'border-primary/70 ring-1 ring-inset ring-primary/50'

// Chat bubbles (session chat, the outbox): one shape for both speakers — the same radius with the tail corner mirrored
// (yours bottom-right, Claude's bottom-left), the same padding, the same hairline edge and whisper shadow (`shadow-card`).
// Only alignment and fill tell them apart: yours a primary tint, right-aligned, at most ~75% wide; Claude's a neutral
// surface, left-aligned, the column's width (it carries markdown). Claude's fill sits between the palette's tested
// surfaces (card / background) in light and a step above card in dark. Inside both, quiet text and links are pulled
// toward the ink (muted 20%; links 40% on the primary tint, 30% on Claude's) so they keep >= 4.5:1 on the fill.
const BUBBLE = 'min-w-0 rounded-[1.25rem] px-3.5 py-2.5 shadow-card [overflow-wrap:anywhere] sm:px-4'
const MINE_SHAPE = `${BUBBLE} w-fit max-w-[75%] rounded-br-md text-foreground max-sm:max-w-[85%] [--bubble-link:color-mix(in_oklab,var(--primary),var(--foreground)_40%)] [&>*]:[--primary:var(--bubble-link)]`
export const BUBBLE_MINE = `${MINE_SHAPE} bg-[color-mix(in_oklab,var(--primary)_13%,var(--background))] dark:bg-[color-mix(in_oklab,var(--primary)_22%,var(--background))]`
// Not handed over yet (queued in Claude Code, pending / sending in the outbox): the same bubble, outlined, not filled.
export const BUBBLE_MINE_PENDING = `${MINE_SHAPE} bg-[color-mix(in_oklab,var(--primary)_5%,var(--background))] shadow-none ring-1 ring-primary/40 ring-inset`
export const BUBBLE_MINE_FAILED = `${MINE_SHAPE} bg-destructive/8 shadow-none ring-1 ring-destructive/40 ring-inset`
export const BUBBLE_THEIRS = `${BUBBLE} w-full rounded-bl-md bg-[color-mix(in_oklab,var(--card)_80%,var(--background))] text-card-foreground [--reply-muted:color-mix(in_oklab,var(--muted-foreground),var(--foreground)_20%)] [--bubble-link:color-mix(in_oklab,var(--primary),var(--foreground)_30%)] [&>*]:[--muted-foreground:var(--reply-muted)] [&>*]:[--primary:var(--bubble-link)] dark:bg-[color-mix(in_oklab,var(--card),var(--foreground)_4%)]`

// Segmented controls (List | Board, the status / host filters, Chat | Term, text size, …): a soft pill track, the
// chosen segment a raised pill on it. Items use the toggle group's default spacing hook (`spacing={0.5}`), so the
// group's own `spacing=0` radius / padding overrides stay out of the way.
export const SEGMENTED = 'shrink-0 rounded-full bg-fill p-0.5'
export const SEGMENT =
  'rounded-full text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-seg data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_0_var(--shadow-tint-2),0_0_0_0.5px_var(--edge-strong)] aria-pressed:bg-transparent'
// A filter segment: label + a muted count.
export const FILTER_SEGMENT = `${SEGMENT} gap-1.5 font-medium`

// A quiet toolbar: a row of icon buttons on one soft pill.
export const TOOLBAR = 'flex shrink-0 items-center gap-0.5 rounded-full bg-fill p-0.5'

// Chips (host, backend, PR, task, job, workspace, stack, subagents, …): soft filled pills, no outline; colour only
// where it means something, and then soft. CHIP is the shape, CHIP_QUIET the neutral fill.
export const CHIP = 'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.75 text-2xs font-medium whitespace-nowrap'
export const CHIP_QUIET = 'bg-fill text-muted-foreground'
// The model chip (session header): neutral like CHIP_QUIET, but a stronger fill and the ink, so the model reads at a
// glance next to the status — on the page and on a washed header alike.
export const MODEL_CHIP = 'bg-fill-strong font-semibold text-foreground'
// Small headings over grouped sections (settings, details, sidebar groups).
export const SECTION_LABEL = 'text-2xs font-semibold tracking-[0.08em] text-dimmer uppercase'
// A grouped inset section: rows on one soft surface.
export const INSET_GROUP = 'rounded-2xl bg-card shadow-float'

// One stable colour per host name (slots --host-0..3).
// Soft fill in the host colour; the label is that colour pulled toward the ink, so it reads (>= 4.5:1) on the fill.
const HOST_BADGE = [
  'bg-host-0/12 text-[color-mix(in_oklab,var(--color-host-0),var(--color-foreground)_60%)]',
  'bg-host-1/12 text-[color-mix(in_oklab,var(--color-host-1),var(--color-foreground)_60%)]',
  'bg-host-2/12 text-[color-mix(in_oklab,var(--color-host-2),var(--color-foreground)_60%)]',
  'bg-host-3/12 text-[color-mix(in_oklab,var(--color-host-3),var(--color-foreground)_60%)]',
]
const HOST_DOT = ['bg-host-0', 'bg-host-1', 'bg-host-2', 'bg-host-3']

export const hostBadgeClass = (host: string | null | undefined) => HOST_BADGE[hostColorSlot(host)]
export const hostDotClass = (host: string | null | undefined) => HOST_DOT[hostColorSlot(host)]

// Context-window usage bands (ctxLevel): text + meter fill.
export const CTX_TEXT: Record<CtxLevel, string> = {
  low: 'text-dimmer',
  warn: 'text-[color:var(--tone-status-waiting,var(--status-waiting))]',
  hot: 'text-status-error',
}
export const CTX_FILL: Record<CtxLevel, string> = {
  low: 'bg-dimmer',
  warn: 'bg-status-waiting',
  hot: 'bg-status-error',
}

// Subscription-usage bands (usageLevel): the calm band is plain text and the primary fill.
export const USAGE_TEXT: Record<CtxLevel, string> = {
  low: 'text-foreground',
  warn: 'text-status-waiting',
  hot: 'text-status-error',
}
export const USAGE_FILL: Record<CtxLevel, string> = {
  low: 'bg-primary',
  warn: 'bg-status-waiting',
  hot: 'bg-status-error',
}

// My tasks: a Productive colour per mode as `--tc` (the element also carries lib/tasks.ts → taskColorStyle()).
export const TASK_COLOR = '[--tc:var(--tc-l)] dark:[--tc:var(--tc-d)]'

// Task cards (My tasks, In sessions, Today): a floating surface with a 1px border (transparent at rest), so a state
// frame is drawn on the card itself and no scroll container can clip it.
export const TASK_CARD = 'rounded-[0.875rem] border border-transparent bg-float text-sm shadow-float transition-[border-color,box-shadow] duration-(--dur-base) hover:shadow-float-hover'
// The inner corner matching TASK_CARD's radius inside its 1px border (header rows, full-card links).
export const TASK_CARD_INNER_TOP = 'rounded-t-[calc(0.875rem-1px)]'
// A card a live session links (lib/tasks.ts taskActivity, any status) on Today: an even green frame (the card's own
// border, a little stronger under the pointer); each session in it keeps its own status colour (TASK_ACTIVITY_TEXT).
export const TASK_ACTIVITY_CARD = 'border-status-busy/50 hover:border-status-busy/80'

// Pull requests: a card's rotting stage (lib/prs.ts rotting) as the card's own 1px border in the stage colour (critical
// doubled with an inset ring), so no scroll container clips it.
export const PR_ROT_RING: Record<'warming' | 'stale' | 'rotting' | 'critical', string> = {
  warming: 'border-status-busy/50',
  stale: 'border-status-waiting/60',
  rotting: 'border-status-rotting/65',
  critical: 'border-status-error/75 ring-1 ring-inset ring-status-error/40',
}
// A session's "working" / "needs you" / "idle" label on a task card: the status colour pulled toward the text colour,
// so the small label stays readable (4.5:1) in every palette and mode.
export const TASK_ACTIVITY_TEXT: Record<StatusKey, string> = {
  busy: 'text-[color-mix(in_oklab,var(--color-status-busy),var(--color-foreground)_30%)]',
  waiting: 'text-[color-mix(in_oklab,var(--color-status-waiting),var(--color-foreground)_40%)]',
  idle: 'text-[color-mix(in_oklab,var(--color-status-idle),var(--color-foreground)_25%)]',
  unknown: 'text-muted-foreground',
}

// Session styles (`style`, web.sessionStyles; lib/sessionStyle.ts): the palette colour as `--tc` (TASK_COLOR on an
// element carrying sessionStyle().vars) and the wash / chip colour `--st` (default `--tc`; SESSION_COLORS can set its
// own per mode, `--st-l` / `--st-d`), the chip's background `--scb` and ink `--sci` (4.5:1). The session header's wash is lib/cardTone.ts.
export const SESSION_STYLE_ST =
  '[--st:var(--st-l,var(--tc-l))] [--scb:var(--scb-l)] [--sci:var(--sci-l)] dark:[--st:var(--st-d,var(--tc-d))] dark:[--scb:var(--scb-d)] dark:[--sci:var(--sci-d)]'
// The chip's frame: the wash colour leaned toward the palette colour, so a lemon frame still shows on a light page.
export const SESSION_STYLE_FRAME = 'border-[color-mix(in_oklab,var(--st)_65%,var(--tc))]'
// The chip: solid in the wash colour (pushed from the ink where it must be), its label in the ink that reads on it.
export const SESSION_STYLE_CHIP = `${SESSION_STYLE_ST} ${SESSION_STYLE_FRAME} bg-(--scb) text-(color:--sci)`

// The session header (lib/cardTone.ts sessionCardTone; list rows and board cards stay plain): a wash — the colour
// `--wash` at the mode's lightness (`--wash-pin`, index.css) mixed into the page background at `--wash-p`. The
// strengths and the text pulls come per mode from the element's inline vars; index.css `[data-wash]` picks the mode's
// and pulls the text tokens inside toward the mode's ink, so text holds its contrast on the wash. The status bottom
// line takes the pulled status colour too (`--tone-status-*`, set on a washed element; plain status colour elsewhere).
export const CARD_WASH_COLOR = {
  busy: '[--wash:var(--status-busy)]',
  waiting: '[--wash:var(--status-waiting)]',
  style: `${SESSION_STYLE_ST} [--wash:var(--st)]`,
} as const
// The wash over the page background, and the status colour as its bottom line.
export const HEAD_WASH = 'bg-[color-mix(in_oklab,var(--wash-pin)_var(--wash-p),var(--color-background))] text-(color:--tone-fg)'
export const HEAD_EDGE: Record<StatusKey, string> = {
  busy: 'border-b-2 border-b-[color:var(--tone-status-busy,var(--status-busy))]',
  waiting: 'border-b-2 border-b-[color:var(--tone-status-waiting,var(--status-waiting))]',
  idle: 'border-b-2 border-b-[color:var(--tone-status-idle,var(--status-idle))]',
  unknown: '',
}
// The session header's own surface and edge (a washed header's HEAD_WASH / HEAD_EDGE win over them): the frame tint
// of the details panel beside it, so the bar stands off the transcript (the page background) while the idle status
// label keeps 4.5:1 on it, and a session-card edge where no status line is drawn (unknown).
export const HEAD_SURFACE = 'border-b border-b-session-edge bg-frame/60'
// Its meta line (status, chips, context, cwd, age), as SESSION_CARD_TEXT: muted text is pulled 30% toward the ink and
// the quiet text (`dimmer`: the age, the cwd, a calm context meter; the unknown / gone status) takes that too, so the
// whole line — quiet chips on their fill included — holds >= 4.5:1 on the header in every palette (dimmer's floor is
// 3.2:1, status-unknown has none).
export const HEAD_META_TEXT =
  '[--head-muted:color-mix(in_oklab,var(--muted-foreground),var(--foreground)_30%)] [--dimmer:var(--head-muted)] [--status-unknown:var(--head-muted)] [&>*]:[--muted-foreground:var(--head-muted)]'
// A chip in it on a wash: its fill leans toward the page instead of the ink, so its label keeps 4.5:1 on the bright
// dark-mode washes too (a lemon session style), where an ink-tinted fill lifts the chip toward its label.
export const HEAD_CHIP = 'in-data-[wash]:bg-background/40'
