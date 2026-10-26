// Types for the fleet web HTTP API (see web/ARCHITECTURE.md → "HTTP API").
// The API is a stable contract: fields are only ever added, so unknown extra
// fields are fine and everything a UI does not strictly need is optional.

/** The registry status, raw. `shell`: idle at the prompt while a background task (a Monitor, a background Bash) still runs. */
export type SessionStatus = 'busy' | 'idle' | 'waiting' | 'shell' | 'unknown'
export type Backend = 'iterm' | 'tmux' | 'unknown'

/** One Claude Code session: a `fleet list --json` row plus the host it runs on. */
export interface Session {
  host: string
  session_id: string
  pid?: number
  name?: string | null
  cwd?: string | null
  /** Unknown strings are possible from newer CLIs — treat as `unknown`. */
  status?: SessionStatus | string | null
  /** Last activity, epoch ms. */
  updated_at?: number | null
  tty?: string | null
  backend?: Backend | string | null
  /** iTerm session id or tmux pane id (`%87`). */
  handle?: string | null
  tab?: string | null
  tmux_session?: string | null
  name_source?: string | null
  waiting_for?: string | null
  /** First prompt, trimmed to ~300 chars for transport. */
  title?: string | null
  /**
   * The session brief's Summary as one short line saying what it does (location noise and markdown dropped, first sentence, ≤ 200 chars; web/lib/brief-format.mjs
   * summaryLine), set by the session's own host from its brief file. Absent when it has no brief or an empty Summary, before
   * the host's first read, and from older servers. Rows and cards show it in place of the first prompt.
   */
  briefSummary?: string
  /**
   * The distinct http(s) URLs in the whole first prompt (before the trim; ≤ 20), set by the server
   * that answered; absent when there are none, and from older servers (then read `title`).
   */
  promptLinks?: string[]
  /**
   * The task URLs (`…/tasks/<id>`, any host) the session's whole transcript mentions, most mentioned
   * first (≤ 10; web/lib/mentions.mjs). Absent when none, before its first background count, for
   * non-Claude sessions, and from older servers.
   */
  taskMentions?: TaskMention[]
  /**
   * Linked to a task by hand ("Link task…"; web/lib/task-links.mjs, set by the session's own host): `{ id }` =
   * that task, `{ id: null }` = no task (automatic links off). Absent when not set, and from older servers.
   */
  manualTask?: { id: string | null }
  /**
   * The slash command (`/name`, no arguments) whose expansion is the first prompt, when it came from
   * one (`fleet list --json` → `first_command`; Claude only). Older CLIs omit it.
   */
  first_command?: string | null
  /**
   * The `web.sessionStyles` rule of the answering server that matches this session: a label and a
   * palette name (lib/tasks.ts TASK_COLORS). Absent when none matches, and from older servers.
   */
  style?: SessionStyle | null
  gen_title?: string | null
  /**
   * The session's one title, computed by the CLI (core::title::display_title): the chosen
   * Claude name, else the generated title, else a heuristic. Older CLIs omit it — use
   * `sessionTitle()` (lib/title.ts), never a field directly.
   */
  display_title?: string | null
  /** Context-window usage from the transcript tail; null when unknown (older CLIs omit it). */
  context?: ContextUsage | null
  /** "Open in editor" link for the cwd (like Brief.editorUrl, without the git-root lookup). Older servers omit it. */
  editorUrl?: string | null
  /**
   * The session stack this session belongs to (`fleet list --json` → `stack`); null = in none.
   * Older CLIs omit the field entirely (undefined = this host knows no stacks).
   */
  stack?: StackRef | null
  /** The coding agent running it (`fleet list --json` → `harness`); older CLIs omit it (= claude). */
  harness?: HarnessId | string | null
  /** The model it runs, when known. */
  model?: string | null
  /** Absolute transcript path (Codex / pi only). */
  transcript?: string | null
  /**
   * The scheduled job run that started it (`fleet list --json` → `origin`, docs/cli.md → Jobs);
   * null = started by hand. Older CLIs omit it.
   */
  origin?: SessionOrigin | null
  /**
   * The subagents (Agent / Task tool) it is running right now, oldest first (`fleet list --json` →
   * `subagents`, docs/architecture.md → Running subagents); `[]` = none. Older CLIs omit it (= none).
   */
  subagents?: Subagent[] | null
  /**
   * The workspace it runs in — a git worktree fleet made for it (`fleet spawn --worktree`, New
   * session → New worktree; `fleet list --json` → `workspace`); null = none. Older CLIs omit it.
   */
  workspace?: SessionWorkspace | null
  /** The host's voice operator (web/lib/operator.mjs): kept out of session lists. Older servers omit it. */
  operator?: boolean
}

/** One of a session's `taskMentions`: a task URL and how often its transcript mentions that task. */
export interface TaskMention {
  url: string
  count: number
}

/** `style` on a session row (web/ARCHITECTURE.md → Session styles). */
export interface SessionStyle {
  label: string
  /** A palette name; an unknown one draws neutral. */
  color: string
}

/** `workspace` on a session row (docs/architecture.md → Workspaces). */
export interface SessionWorkspace {
  /** The whimsical word: the worktree's folder name, and the session's first title. */
  handle: string
  /** The branch as fleet left it: `<prefix>/<handle>`, then `<prefix>/<slug>` once named. */
  branch: string
  /** The worktree (absolute). */
  path: string
  /** Its main checkout (absolute). */
  repo: string
  /** What it branched from (`origin/main`). */
  base: string
  /** Branch and title were named after the work (after the first answer). */
  named: boolean
}

/** `origin` on a session row: the job and the run id (`<job>/<run>` in its tmux environment). */
export interface SessionOrigin {
  job: string
  run: string
}

/** One running subagent on a session row (`subagents[]`). */
export interface Subagent {
  id: string
  /** Its job: the Agent tool call's description. */
  description: string
  /** `general-purpose`, `Explore`, a custom agent's name… */
  agent_type?: string | null
  /** The model it was asked to run (`opus`, a full id…), when given. */
  model?: string | null
  /** Started in the background; false = the session waits on it. */
  background?: boolean
  /** Epoch ms. */
  started_at?: number | null
  /** Epoch ms of its transcript's last write. */
  last_active_at?: number | null
  /** 1 = started by the session, 2 = by one of its subagents… */
  depth?: number
  parent_agent_id?: string | null
}

/** The coding agents fleet drives — see docs/cli.md → Harnesses. */
export type HarnessId = 'claude' | 'codex' | 'pi'

/** GET /api/hosts/:host/harnesses → `harnesses[]` (`fleet harness list --json`). */
export interface HarnessInfo {
  id: HarnessId | string
  label: string
  command: string
  installed: boolean
  /** The picker; `id: ''` is the harness's own default. */
  models: ModelOption[]
}

export interface HarnessesResponse {
  host: string
  harnesses: HarnessInfo[]
}

/** `stack` on a session row. */
export interface StackRef {
  id: string
  label: string
  /** The stack's home host (where its StackBrief lives); older servers omit it (= the session's host). */
  host?: string
}

/** `context` on a session row — see docs/architecture.md → "Context usage". */
export interface ContextUsage {
  /** Prompt tokens of the last main-thread request (input + cache read + cache creation). */
  used: number
  /** Inferred window: 200000 or 1000000. */
  window: number
  /** Whole percent, rounded; may exceed 100. */
  pct: number
  model?: string | null
}

export interface SpawnDir {
  label: string
  path: string
}

/** One Settings → Start directories entry: a label and a directory per host (config `spawnDirs`). */
export interface SpawnDirEntry {
  label: string
  /** host name → directory on that host (absolute or `~/…`); a missing host = not offered there. */
  paths: Record<string, string>
}

/** Whether the answering host's own path of one entry is a directory there (null: no path for it). */
export interface SpawnDirCheck {
  path: string
  /** Absolute, `~` expanded. */
  resolved: string
  exists: boolean
  isDir: boolean
}

/** GET/PUT /api/hosts/:host/spawn-dirs. */
export interface SpawnDirsResponse {
  host: string
  /** This host + every host in its config. */
  hosts: string[]
  spawnDirs: SpawnDirEntry[]
  /** Index-aligned with `spawnDirs`. */
  checks: (SpawnDirCheck | null)[]
  /** What the host offers now (`Host.spawnDirs`). */
  offered: SpawnDir[]
  limits: { maxEntries: number; maxLabel: number; maxPath: number }
  /** PUT only: false for a dry run. */
  saved?: boolean
}

/** A PUT spawn-dirs 400: `errors[].index` into the list sent; `host` = that host's path cell. */
export interface SpawnDirsError {
  error: string
  errors: { index: number; field: 'label' | 'paths' | 'list'; host?: string; error: string }[]
  checks: (SpawnDirCheck | null)[]
}

export interface Host {
  name: string
  ok: boolean
  error?: string
  fetchedAt?: number
  spawnDirs?: SpawnDir[]
  /** Set when that host's server has a notes explorer (`web.notes.root`). */
  notes?: { name: string | null }
  sessions: Session[]
}

/** GET /api/fleet — self first, then peers. */
export interface FleetResponse {
  self: string
  hosts: Host[]
  /** When the merged snapshot was built (epoch ms); absent on `?local=1`. */
  snapshotAt?: number
}

export interface QuickReply {
  label: string
  text: string
}

/** One New session model choice (`web.models`); id '' = no `--model`, Claude's default. */
export interface ModelOption {
  id: string
  label: string
}

/** GET /api/settings */
export interface Settings {
  apiVersion: number
  self: string
  hosts: string[]
  quickReplies: QuickReply[]
  /** `web.uploads.maxMB` of this server (older servers: absent). */
  uploads?: { maxMB: number | null }
  /** Voice prompts (POST /api/transcribe): this server has a transcription key (older servers: absent). */
  transcribe?: { enabled: boolean }
  /** The New session model picker (older servers: absent → lib/models.ts defaults). */
  models?: ModelOption[]
  /** This server's notes explorer (older servers: absent). */
  notes?: { enabled: boolean; name?: string | null }
  /**
   * My tasks (GET /api/tasks) is configured on this server (older servers: absent); `quickStart`: its
   * one-click session starters (`web.tasks.quickStart`; absent on older servers and while tasks are off).
   */
  tasks?: { enabled: boolean; quickStart?: TaskQuickStart[] }
  /** Session stacks on this server (older servers: absent); `generate` = creating one calls `model`. */
  stacks?: { enabled: boolean; model?: string; generate?: boolean }
  /** Spoken replies (POST /api/speak): this server has the key (older servers: absent). */
  speak?: { enabled: boolean; voice?: string | null }
  /** The voice operator (GET/POST /api/operator) is available on this server (older servers: absent). */
  operator?: { enabled: boolean; hosts?: string[] }
}

/**
 * A My tasks quick start (`web.tasks.quickStart`): one click spawns a session on this server's host
 * in `dir` with `prompt` rendered for the task (`{url}`, `{title}`, `{number}`, `{id}`).
 */
export interface TaskQuickStart {
  id: string
  label: string
  /** The template, placeholders unrendered. */
  prompt: string
  /** Absolute on this server's host; null when its start directory label is gone (`error` says so). */
  dir: string | null
  /** The start directory label it names (null: a path in the config). */
  dirLabel: string | null
  /** A model id; null = the default. */
  model: string | null
  /** Start it in a new git worktree of `dir`'s repo. */
  worktree: boolean
  /** A workflow status name to offer moving the task to once the session started (asked first); null/absent: none. */
  setStatus?: string | null
  error?: string
}

/** GET/POST /api/operator — this server's operator session (null until it shows in the fleet). */
export interface OperatorStatus {
  host: string
  dir: string
  session: Session | null
  /** POST: a new operator was started just now. */
  started?: boolean
  tmuxSession?: string | null
}

/** POST /api/transcribe — the recording as text. */
export interface TranscribeResponse {
  text: string
  model: string
}

/** POST /api/hosts/:host/uploads — the stored copy on that host. */
export interface UploadResponse {
  host: string
  /** Absolute path on `host`. */
  path: string
  name: string
  size: number
}

export type FileKind = 'markdown' | 'text' | 'image' | 'pdf' | 'other'

/** Composer autocomplete (GET …/sessions/:id/complete?kind=), listed on the session's host. */
export type CompleteKind = 'skills' | 'files' | 'brain'

export interface CompleteSkill {
  /** Without the slash: `deploy`, `p-dev:review`. */
  name: string
  description: string
  source: 'builtin' | 'user' | 'project' | 'plugin'
  argumentHint?: string
}

export interface CompleteBrainNote {
  /** What goes after `brain:` — the file name, or the path when two notes share it. */
  ref: string
  /** Relative to the brain root. */
  path: string
  title?: string
}

export interface CompleteResponse {
  host: string
  id: string
  kind: CompleteKind
  skills?: CompleteSkill[]
  /** .md / .plain files, relative to the session cwd. */
  files?: string[]
  /** kind=brain: false when the host has no ~/.brainrc. */
  available?: boolean
  notes?: CompleteBrainNote[]
  truncated?: boolean
}

/** One entry of POST …/sessions/:id/files/stat — a path mentioned in chat, resolved on the session's host. */
export interface FileStat {
  /** What was asked (`docs/a.md:12`). */
  input: string
  /** Absolute path on the host (resolved against the session cwd). */
  path: string
  /** Relative to the cwd when inside it, else `~/…`, else absolute. */
  rel?: string
  line?: number
  col?: number
  exists: boolean
  /** Outside $HOME / the cwd, or a secret store: never served. */
  forbidden?: boolean
  isFile?: boolean
  isDir?: boolean
  size?: number
  mtime?: number
  kind?: FileKind
}

export interface FileStatResponse {
  host: string
  id: string
  cwd: string | null
  home: string
  files: FileStat[]
}

export interface FileOpenResponse {
  ok: true
  host: string
  path: string
  /** A runnable file was revealed in its folder instead of opened. */
  revealed: boolean
  command: string
}

export interface AutoNameRun {
  host?: string
  ok?: boolean
  at?: number
  ms?: number
  reason?: string
  dryRun?: boolean
  renamed?: { from: string; to: string }[]
  tmux?: string[]
  held?: string[]
  errors?: string[]
  error?: string
}

/** GET /api/health */
export interface Health {
  name: string
  version: string
  apiVersion: number
  self: string
  uptime: number
  now: number
  autoName: { enabled: boolean; intervalMinutes: number; lastRun: AutoNameRun | null }
}

/** GET /api/hosts/:host/sessions/:id/peek */
export interface PeekResponse {
  host: string
  id: string
  backend: Backend | string
  lines: number
  text: string
  /** Claude's permission mode from its status line; null when none is on screen (or not Claude). Older servers omit it. */
  mode?: PermissionMode | null
  capturedAt: number
}

/** A Claude Code permission mode as its status line shows it (`bypass` = bypass permissions). */
export interface PermissionMode {
  id: 'manual' | 'acceptEdits' | 'plan' | 'bypass' | 'auto' | 'dontAsk' | string
  /** As Claude prints it: "bypass permissions", "auto mode"… */
  label: string
}

/** The modes the mode switch moves between (POST …/keys `until`). */
export type ModeTarget = 'bypass' | 'auto'

/**
 * POST …/keys `{ key: "BTab", until }`: Shift+Tab until the status line shows `until`. 409 bodies:
 * `held: "waiting"` (a prompt or question), `unavailable` (+ `restart: true` for bypass: the mode is not in
 * the session's cycle), `candidates` (an ambiguous id).
 */
export interface ModeSwitchResponse {
  ok: true
  host: string
  id: string
  mode: PermissionMode | null
  from: PermissionMode | null
  presses: number
  cycle: string[]
  already: boolean
}

export type MessageRole = 'user' | 'assistant' | 'system'
export type MessageKind = 'user' | 'assistant' | 'command' | 'system' | 'question'

/** One question of Claude's AskUserQuestion prompt. */
export interface Question {
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description: string }[]
}

/** POST …/answer: one entry per question, in order (option indexes and/or typed text). */
export interface QuestionAnswer {
  options: number[]
  text?: string | null
}

export interface Message {
  role: MessageRole
  kind: MessageKind
  text: string
  ts?: number | null
  /** Assistant text that ends a turn; `false` = narration between tool calls. */
  final?: boolean
  /** kind 'command': the slash command / skill (`/p-dev:review`), or `!` for a shell command. */
  name?: string
  /** kind 'command': what was typed after the command, when anything was. */
  args?: string
  /** kind 'question': the AskUserQuestion tool call's id (what …/answer names). */
  id?: string
  /** kind 'question': the prompt (`text` is its markdown rendering). */
  questions?: Question[]
  /** kind 'question': the answers, per question, once answered. */
  answers?: (string | null)[]
  /** kind 'question': dismissed (Esc, "Chat about this", interrupted). */
  declined?: boolean
  /** kind 'user': typed while Claude works, still in its queue (always last). */
  queued?: boolean
}

/** GET /api/hosts/:host/sessions/:id/messages */
export interface MessagesResponse {
  host: string
  id: string
  status: SessionStatus | string
  backend: Backend | string
  name?: string | null
  limit: number
  messages: Message[]
  total: number
  truncated: boolean
  updatedAt?: number | null
  capturedAt: number
}

/** Keys POST …/keys presses (server `ALLOWED_KEYS`): `BTab` = Shift+Tab, `BSpace` = Backspace. */
export type SessionKey =
  | 'Enter'
  | 'Escape'
  | 'Up'
  | 'Down'
  | 'Left'
  | 'Right'
  | 'Tab'
  | 'BTab'
  | 'Space'
  | 'BSpace'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown'

export interface SpawnRequest {
  /** Still accepted by the server; the UI leaves naming to the auto-namer. */
  name?: string
  dir?: string
  prompt?: string
  /** A `models` id; '' / absent = the harness's default. */
  model?: string
  /** Which coding agent to start; absent = claude. */
  harness?: HarnessId | string
  /** Start it in a new git worktree of `dir`'s repo (`fleet workspace new`); a `name` is its handle. */
  worktree?: boolean
  /** Madrid: the player it starts as; the server names it `<player> <n>` (its counter's next number). */
  player?: string
}

/** `fleet workspace new --json`: what fleet made for a worktree spawn. */
export interface WorkspaceRecord {
  version: number
  handle: string
  path: string
  repo: string
  remote: string
  base: string
  prefix: string | null
  createdBranch: string
  branch: string
  createdAt: number
  slug: string | null
  title: string | null
  named: boolean
}

export interface SpawnResponse {
  ok: boolean
  host: string
  name: string
  dir: string
  tmuxSession: string
  command: string
  trusted: boolean
  /** A `worktree: true` spawn: the workspace it was started in. */
  workspace?: WorkspaceRecord
}

export interface KillResponse {
  ok: true
  host: string
  id: string
  name?: string | null
  process: 'terminated' | 'killed' | 'gone' | 'skipped' | string
  terminal: string
  /** `{ restart: "bypass" }` only: the resume line typed into the same pane (null when it was already in bypass). */
  restarted?: { command: string } | null
  /** `restart` only: the mode the resumed session shows (null: not on screen yet). */
  mode?: PermissionMode | null
  already?: boolean
}

/** A live session inside a worktree that is about to be deleted (it blocks the delete). */
export interface WorktreeSession {
  host: string | null
  id: string | null
  name: string | null
  title: string | null
  cwd: string
  status: string | null
}

/** A process tree started in the worktree that Delete stops before removing it (lib/devservers.mjs). */
export interface DevServer {
  pid: number
  /** Set: the whole process group is signalled; null: `pid` and its descendants. */
  pgid: number | null
  label: string
  command: string | null
  /** Ports it (or its tree) listens on. */
  ports: number[]
  pids: number[]
  /** It runs under the session being closed (it normally ends with it). */
  underSession: boolean
}

/** A process inside the worktree that Delete leaves alone, and what it belongs to (`via`). */
export interface KeptProcess {
  pid: number
  label: string
  command: string | null
  ports: number[]
  via: string
}

/** A dev-environment leftover of the worktree cleaned after it is removed (lib/leftovers.mjs). */
export interface LeftoverPlan {
  kind: 'fe-live-env' | 'puma-dev' | 'watchman' | string
  name: string
  port: number | null
  /** Why it will be left (null: it goes). */
  keep: string | null
}

/** GET …/sessions/:id/worktree — what Delete would do (changes nothing). */
export interface WorktreeInspect {
  host: string
  id: string
  name: string | null
  cwd: string | null
  /** `remove-worktree`: close + `git worktree remove`; `close-only`: the directory is left alone. */
  action: 'remove-worktree' | 'close-only'
  /** Why it only closes: no cwd, outside git, or the repo's main checkout. */
  reason: 'no-cwd' | 'not-git' | 'main-checkout' | null
  checkout: { path: string; branch: string | null; linked: boolean } | null
  worktree: {
    path: string
    branch: string | null
    mainPath: string
    locked: boolean
    dirty: { count: number; files: { status: string; path: string }[] }
    unpushed: { count: number; commits: { sha: string; subject: string }[] }
  } | null
  /**
   * A workspace fleet made for this session: its branch goes too when `deleteBranch` (still on
   * it, nothing unpushed). null = not one (the branch is kept). Older servers omit it.
   */
  workspace?: { handle: string | null; branch: string; deleteBranch: boolean } | null
  /** Other live sessions inside the worktree: the delete is refused while they run. */
  sessions: WorktreeSession[]
  blocked: boolean
  /** Uncommitted changes or unpushed commits: only a forced delete removes it. */
  needsForce: boolean
  /** Processes started in the worktree, stopped before it is removed; `kept`: inside but left alone. Older servers omit it. */
  servers?: { stop: DevServer[]; kept: KeptProcess[]; error: string | null }
  /** Leftovers cleaned after it is removed (fe-live-env state, puma-dev hosts, watchman roots). Older servers omit it. */
  leftovers?: LeftoverPlan[]
}

/** POST …/sessions/:id/delete → closed (KillResponse) + what happened to the worktree. 409 = refused, the body is a WorktreeInspect + `refused`. */
export interface DeleteResponse extends KillResponse {
  action: WorktreeInspect['action']
  reason: WorktreeInspect['reason']
  worktree: {
    path: string
    branch: string | null
    removed: boolean
    forced: boolean
    pruned: boolean
    error: string | null
    /** A fleet-made workspace only: its branch was deleted, or why not. */
    branchDeleted?: boolean
    branchNote?: string | null
  } | null
  /** What was stopped in the worktree before it was removed. Older servers omit it. */
  servers?: {
    stopped: (DevServer & { result: 'terminated' | 'killed' | 'gone' | 'failed' | string; error: string | null })[]
    kept: KeptProcess[]
    error: string | null
  }
  /** What was cleaned after it. Older servers omit it. */
  leftovers?: { kind: LeftoverPlan['kind']; name: string; result: 'removed' | 'kept' | 'failed' | string; note: string | null }[]
}

/** POST /api/hosts/:host/sessions/:id/rename → `fleet rename --json` (409 when held). */
export interface RenameResponse {
  ok: boolean
  host: string
  id: string
  /** `renamed` (confirmed), `sent` (typed, not reflected yet), `held` (nothing sent). */
  result: 'renamed' | 'sent' | 'held' | string
  title: string
  from?: string
  /** Why nothing was sent: `waiting` (on a permission prompt / question). */
  held?: 'waiting' | string | null
  tmux?: { renamed: boolean; from?: string | null; to?: string | null; note: string } | null
  message?: string
}

export interface OkResponse {
  ok: true
}

/** POST …/send-now: Claude Code's send-now chord was pressed; `queued` = the prompts it hands over. */
export interface SendNowResponse {
  ok: true
  queued: number
}

/** One member of a group: a session on a host (`id` = session_id, or String(pid) without one). */
export interface GroupMember {
  host: string
  id: string
  /** Set by servers that know session recovery: the session is dormant (a reboot left it, not resumed yet). */
  dormant?: boolean
}

/** A smart group of sessions (`fleet group`). Ids are stable across runs. */
export interface SessionGroup {
  id: string
  label: string
  description?: string | null
  /** `llm` (model-made) or `fallback` (grouped by repo). */
  source?: 'llm' | 'fallback' | string
  members: GroupMember[]
}

export interface GroupRun {
  at: number
  ms: number
  ok: boolean
  reason?: 'scheduled' | 'manual' | 'startup' | 'changes' | string
  mode?: 'noop' | 'incremental' | 'consolidate' | 'full' | 'fallback' | 'default' | string
  modelCalls?: number
  classified?: number
  error?: string
  note?: string
}

/** GET /api/groups (and POST /api/groups/run). `enabled: false` → the UI groups by repo itself. */
export interface GroupsResponse {
  enabled: boolean
  /** The host that runs the grouping pass. */
  host: string | null
  intervalMinutes: number | null
  running: boolean
  /** Epoch ms of the last applied grouping state. */
  updatedAt: number | null
  lastRun: GroupRun | null
  groups: SessionGroup[]
  /** The default group's id: live sessions no group claims go there. Null / absent: none (older servers). */
  defaultGroup?: string | null
  error?: string
}

/** A `## Resources` bullet of a session brief. `url` or `path` is set; `kind: null` = a hand-written line. */
export type BriefResourceKind = 'PR' | 'Issue' | 'Artifact' | 'Spec' | 'File' | 'Git' | 'Branch' | 'Worktree' | 'Link'

export interface BriefResource {
  kind: BriefResourceKind | string | null
  label: string | null
  url: string | null
  /**
   * Relative to the session cwd when inside it, else `~/…`, else absolute (a branch name for the
   * legacy `Branch`; the repo / worktree root for `Git`).
   */
  path: string | null
  /** The bullet as written. */
  text: string
  /** `Git` only (null otherwise; older servers omit it): the branch, null when detached. */
  branch?: string | null
  /** `Git` only: true = a linked worktree, false = the main checkout (null: unknown / not Git). */
  linked?: boolean | null
}

// --- Session stacks (GET/PUT/DELETE /api/hosts/:host/stacks/…) ------------------------------

/** One member of a stack (StackBrief frontmatter `members[]` + live data from discovery). */
export interface StackMember {
  session: string
  host: string
  /** The display title at the last sync (informational). */
  name: string | null
  /** ISO 8601. */
  added: string | null
  /** ISO 8601 once the session is gone; null while live. */
  closed: string | null
  /** Live right now (discovery at render time). */
  live?: boolean
  /** Dormant on its host (a reboot left it; resume it from the Dormant section). */
  dormant?: boolean
  status?: SessionStatus | string | null
  briefPath?: string | null
  briefExists?: boolean
}

/** `fleet stack show --json` (+ the server's `editorUrl`). */
export interface StackView {
  host: string
  id: string
  label: string
  /** Absolute path of the StackBrief on `host`. */
  path: string
  cwd: string | null
  absCwd: string | null
  created: string | null
  updated: string | null
  generatedAt: string | null
  editedAt: string | null
  /** The sentence every sibling's first prompt starts with (on the stack's home host). */
  contextLine: string
  /** The same for a sibling on another host (`fleet -H <home> stack …`); older CLIs omit it. */
  remoteContextLine?: string
  members: StackMember[]
  /** The whole file, frontmatter included (what the editor edits). */
  markdown: string
  /** Without frontmatter. */
  body: string
  parsed: { summary: string; resources: BriefResource[]; notes: string }
  /** Open the stack's directory in the editor; null / absent = hide the button. */
  editorUrl?: string | null
}

/** GET /api/hosts/:host/stacks */
export interface StacksResponse {
  host: string
  stacks: StackView[]
}

/** The body of both stack spawn routes. */
export interface StackSpawnRequest {
  prompt?: string
  name?: string
  model?: string
  harness?: HarnessId | string
  /** Label for a stack this spawn creates (the model's otherwise). */
  label?: string
  /** Start the sibling on this host (a peer of the stack's home; default: the home itself). */
  host?: string
  /** Where it starts: required with `host`, a path on that host. */
  dir?: string
  /** Madrid: as `SpawnRequest.player`. */
  player?: string
}

/** POST …/sessions/:id/stack/spawn and …/stacks/:id/spawn. */
export interface StackSpawnResponse {
  host: string
  stack: StackView
  /** A new stack was created around the source session. */
  created: boolean
  /** The StackBrief came from the model (false: the skeleton fallback). */
  generated: boolean
  spawn: Omit<SpawnResponse, 'host' | 'ok'> & { host?: string; ok?: boolean; model?: string | null }
}

/** A `## Todos` checkbox line. */
export interface BriefTodo {
  done: boolean
  text: string
}

/** @deprecated the section is `## Todos` now — use BriefTodo. */
export type BriefPlanItem = BriefTodo

/** GET/PUT /api/hosts/:host/sessions/:id/brief (`exists: false` = the empty skeleton, no file yet). */
export interface Brief {
  host: string
  id: string
  exists: boolean
  /** The whole file, frontmatter included. */
  markdown: string
  parsed: {
    summary: string
    resources: BriefResource[]
    /** Older servers omit it — fall back to `plan`. */
    todos?: BriefTodo[]
    /** @deprecated alias of `todos` (same array), kept for one release. */
    plan: BriefTodo[]
  }
  /** ISO 8601 (frontmatter), null when never written. */
  updated: string | null
  editedAt: string | null
  generatedAt: string | null
  generatedThrough: number
  generating: boolean
  /** Background generation is on for that host (`web.briefs.enabled`). */
  enabled: boolean
  /** The first prompt for a new session that continues this one. */
  continuePrompt: string
  /** The session's directory on its host, absolute (no `~`); null when unknown. Older servers omit it. */
  absCwd?: string | null
  /** The git checkout root (repo or linked worktree) containing absCwd, absolute; null outside git. */
  gitRoot?: string | null
  /** `web.editor` of the server that answered: which editor `editorUrl` opens; null = hide the button. */
  editor?: 'vscode' | 'cursor' | null
  /**
   * `vscode://file/<path>` for a session on the answering server's host, or
   * `vscode://vscode-remote/ssh-remote+<alias><path>` for another host (`cursor://…` alike);
   * gitRoot preferred over absCwd. null: no editor, no path, or no ssh alias for that host.
   */
  editorUrl?: string | null
  /** The git checkouts the session works in (its cwd's first, then those of its files). Older servers omit it. */
  worktrees?: BriefWorktree[]
}

/** One checkout in Brief.worktrees. */
export interface BriefWorktree {
  /** The checkout root on the session's host, absolute. */
  path: string
  /** `path` with `~` for the home dir. */
  display: string
  /** null when detached. */
  branch: string | null
  /** true = a linked worktree, false = the main checkout. */
  linked: boolean
  /** "Open in editor" link for `path` (see Brief.editorUrl); null = no button. */
  editorUrl?: string | null
}

/** POST …/brief/regenerate (202). */
export interface BriefRegenerateResponse {
  host: string
  id: string
  started: boolean
  queued: boolean
  generating: true
}

// --- Notes explorer (GET /api/hosts/:host/notes/*) ------------------------------------------

export type NoteKind = 'markdown' | 'text' | 'image'

export interface NoteEntry {
  /** Root-relative, `/`-separated. */
  path: string
  kind: NoteKind
  size: number
  mtime: number
  /** Markdown: frontmatter `title`, else the first `# heading`, else the file name. */
  title?: string
  /** Had age-encrypted blocks (withheld by the server). */
  encrypted?: boolean
}

export interface NotesTree {
  host: string
  name: string
  /** Display path (`~/…`). */
  root: string
  rootAbs: string
  searchEngine: 'builtin' | 'command'
  files: NoteEntry[]
  truncated: boolean
  scannedAt: number
  editorUrl: string | null
}

export interface NoteMatch {
  /** 1-based; null when the search command gave no line numbers. */
  line: number | null
  text: string
  /** [start, end) of each match in `text`. */
  ranges: [number, number][]
}

export interface NoteHit {
  path: string
  kind: NoteKind
  title: string
  mtime: number
  score: number
  matches: NoteMatch[]
  more: number
}

export interface NotesSearch {
  host: string
  q: string
  engine: 'builtin' | 'command'
  /** The search command failed and the built-in search answered instead. */
  fallback?: string
  results: NoteHit[]
  total: number
  ms: number
}

export interface NoteFile {
  host: string
  path: string
  abs: string
  kind: NoteKind
  size: number
  mtime: number
  title: string
  encrypted: boolean
  /** Frontmatter, in file order. */
  meta: [string, string | string[]][]
  body: string
  /** The line `body` starts on. */
  bodyLine: number
  text: string
  editorUrl: string | null
}

// --- Subscription usage (GET /api/hosts/:host/usage → `fleet usage --json`) -------------------

export interface UsageAccount {
  uuid: string | null
  email: string | null
  organization: string | null
  /** `pro`, `max`, `team`, `enterprise`, … */
  plan: string | null
  tier: string | null
  /** e.g. `Team · Max 5x`. */
  plan_label: string | null
}

export interface UsageLimit {
  /** `session`, `weekly_all`, `weekly_scoped`, … */
  kind: string
  /** `session` | `weekly`. */
  group: string
  label: string
  /** The model a scoped limit counts (`Fable`, `Opus`, …). */
  model: string | null
  /** 0–100 (may exceed 100). */
  percent: number
  /** `normal`, `warning`, `critical`, … (open set). */
  severity: string
  resets_at: string | null
  /** The limit currently binding. */
  active: boolean
}

export interface UsageExtra {
  enabled: boolean
  used: number | null
  limit: number | null
  currency: string | null
  percent: number | null
}

export interface UsageResponse {
  host: string
  account: UsageAccount | null
  limits: UsageLimit[]
  extra_usage: UsageExtra | null
  /** RFC 3339: when the numbers were read from Anthropic. */
  fetched_at: string
  /** A refresh failed; these are the last good numbers. */
  stale: boolean
  error: string | null
}

/** A Claude session inside a dormant entry (`fleet restore --json`). */
export interface DormantSession {
  sessionId: string
  name: string | null
  title: string | null
  cwd: string | null
  /** `codex` / `pi`; absent = Claude (newer CLIs). */
  harness?: string
}

/** One dormant tmux session (`kind: tmux`) or lone Claude session (`kind: claude`) a reboot left. */
export interface DormantView {
  kind: 'tmux' | 'claude' | string
  /** What `fleet restore <target>` takes: the tmux name, or the full session id. */
  target: string
  /** The tmux name, or the Claude title. */
  name: string
  /** When it went down (ISO). */
  since: string | null
  windows: number
  panes: number
  sessions: DormantSession[]
}

/**
 * One recently closed entry (ended within a boot: Close, kill, /exit): a DormantView (`since` =
 * `closedAt`) + `tmuxSession` when a Claude session's tmux pane outlived it (it resumes in a new
 * window there). Never part of Resume all, never on the Board.
 */
export interface ClosedView extends DormantView {
  closedAt: string | null
  tmuxSession?: string
}

/** The closed / dormant entry GET …/dormant/sessions/:id/messages resolved `:id` to. */
export interface PastRecord {
  pool: 'closed' | 'dormant'
  kind: 'tmux' | 'claude' | string | null
  /** What …/dormant/restore takes (with `closed: true` for a closed one). */
  target: string | null
  /** The entry's name: the tmux name, or the Claude title. */
  name: string | null
  /** This Claude session's title / name. */
  title: string | null
  sessionName: string | null
  cwd: string | null
  harness: string
  since: string | null
  closedAt: string | null
  tmuxSession: string | null
}

/** GET /api/hosts/:host/dormant/sessions/:id/messages — the live `messages` shape, read-only, plus `record`. */
export interface PastMessagesResponse extends Omit<MessagesResponse, 'status' | 'backend'> {
  status: 'closed' | 'dormant'
  backend: null
  record: PastRecord
}

/** GET /api/hosts/:host/dormant. */
export interface DormantResponse {
  host: string
  bootId: string | null
  dormant: DormantView[]
  /** Recently closed sessions (servers / CLIs that know them). */
  closed?: ClosedView[]
}

export interface RestoredEntry {
  kind: string
  from: string
  /** The tmux session it now lives in. */
  session: string
  renamed: boolean
  windows: number
  panes: number
  launched: { sessionId: string; title: string | null; line: string }[]
  warnings: string[]
  commands: string[]
  dryRun: boolean
}

/** POST /api/hosts/:host/dormant/restore. 409 `{ error, candidates }` when the target is ambiguous. */
export interface RestoreResponse {
  host: string
  restored: RestoredEntry[]
  failed: { target: string; error: string }[]
}

/** POST /api/hosts/:host/dormant/forget. */
export interface ForgetResponse {
  host: string
  forgotten: string[]
}

// --- Git repos (Settings → Git repos; GET/PUT /api/hosts/:host/repos → `fleet repos`) -----------

/** Config `repos` on one host (defaults filled in). Keys of `overrides` / `exclude`: a dir name or a `~/…` path. */
export interface ReposSettings {
  roots: string[]
  /** `30m` / `12h` / `7d`. */
  every: string
  overrides: Record<string, string>
  exclude: string[]
}

export type RepoOutcome = 'updated' | 'current' | 'ahead' | 'diverged' | 'blocked' | 'busy' | 'noUpstream' | 'noRemote' | 'fetchFailed'

/** One row of `fleet repos --json --all`. */
export interface RepoRow {
  name: string
  /** `~/…` */
  path: string
  /** Sync interval in seconds. */
  every: number
  excluded: boolean
  due: boolean
  branch: string | null
  upstream?: string | null
  ahead: number
  behind: number
  dirty: number
  busy?: string | null
  lastAttempt?: number | null
  lastFetch?: number | null
  outcome?: RepoOutcome | null
  detail?: string | null
}

export interface ReposResponse {
  host: string
  settings: ReposSettings
  repos: RepoRow[]
  /** Listing the repos failed (the settings are still there). */
  error: string | null
  service: { installed: boolean; supported: boolean; tickMinutes: number }
  /** PUT only. */
  saved?: boolean
}

/** One result of `fleet repos sync --json`. */
export interface RepoSyncResult {
  name: string
  path: string
  branch?: string | null
  outcome: RepoOutcome
  pulled: number
  defaultBranch?: { branch: string; pulled: number }
  detail?: string
}

/** A `fleet prs` column id (docs/cli.md → Pull requests). */
export type PrColumnId = 'unseenMentions' | 'waitingOnMe' | 'reviewMine' | 'readyToMergeMine' | 'draftMine' | 'waitingOnAuthor'

export interface PrColumn {
  id: PrColumnId
  title: string
  count: number
}

export interface PullRequest {
  column: PrColumnId
  owner: string
  repo: string
  number: number
  title: string
  url: string
  author: string
  draft: boolean
  /** ms epoch */
  createdAt: number
  updatedAt: number
  additions: number
  deletions: number
  changedFiles: number
  size: 'XS' | 'S' | 'M' | 'L' | 'XL'
  baseBranch: string
  headBranch: string
  headOid: string | null
  reviewDecision: 'approved' | 'changesRequested' | 'reviewRequired' | null
  checks: 'success' | 'failure' | 'error' | 'pending' | 'expected' | null
  comments: number
  requestedReviewers: string[]
  myReview: { state: string; at: number | null; newCommits: boolean } | null
  /** The latest @mention of you by someone else; unseen → the PR is in `unseenMentions`. */
  mention?: PrMention
  /** How long it has waited, by its column's thresholds (absent from older servers). */
  rotting?: PrRotting
  /** The distinct http(s) URLs in its description, in order, ≤ 20 (absent from older servers). */
  links?: string[]
  /** Where the repo / head branch is checked out on the answering host. */
  /** `editorUrl`: "Open in VS Code / Cursor" for the worktree, from the server the browser asked (null: no link). */
  local?: { repoPath: string; worktree: string | null; editorUrl?: string | null }
}

export type PrRotting = 'fresh' | 'warming' | 'stale' | 'rotting' | 'critical'

export interface PrMention {
  /** ms epoch */
  at: number
  author: string
  /** The comment / review it was said in. */
  url: string
  /** The line with the mention, shortened. */
  excerpt: string
  /** You commented or reviewed after it. */
  answered: boolean
  /** Answered, or marked seen after it. */
  seen: boolean
}

/** GET /api/hosts/:host/prs */
export interface PrsResponse {
  host: string
  user: string
  scope: string
  fetchedAt: number
  stale: boolean
  error: string | null
  truncated: boolean
  columns: PrColumn[]
  prs: PullRequest[]
}

/** A PR checked out in a worktree (`fleet pr checkout --json`). */
export interface PrWorktree {
  owner: string
  repo: string
  number: number
  title?: string
  url?: string
  headBranch?: string
  baseBranch?: string
  /** The local branch (`pr-<n>` for a fork's PR). */
  branch: string
  path: string
  repoPath?: string
  /** Made by this call (false: it was already checked out). */
  created: boolean
  contextLine: string
  /** "Open in VS Code / Cursor" for `path` (null: no link). */
  editorUrl?: string | null
}

/** One of your open tasks (GET /api/tasks; Productive). */
export interface Task {
  id: string
  /** The task's number as Productive shows it (`#123`). */
  number: string | null
  title: string
  /** The task in the Productive app. */
  url: string
  project: string | null
  /** Its workflow status (e.g. "In progress"). */
  status: string | null
  statusCategory: 'notStarted' | 'started' | 'closed' | null
  /**
   * The workflow status's colour: a Productive palette name (`yellow`, `logan`, … — lib/tasks.ts →
   * TASK_COLORS); null = no status. Older servers omit it (= none).
   */
  statusColor?: string | null
  /** The project's colour (a Productive palette name), null when it has none set. Older servers omit it. */
  projectColor?: string | null
  /** `YYYY-MM-DD` */
  dueDate: string | null
  /** ms epoch */
  updatedAt: number | null
  /** A key task: Productive's milestone, the container of a piece of work. Older servers omit these. */
  keyTask?: boolean
  /** Its parent task (when it is a subtask). */
  parent?: TaskRef | null
  /** Its subtask tree's top task, when that is not the parent (a subtask of a subtask). */
  root?: TaskRef | null
  subtasks?: TaskCount | null
  todos?: TaskCount | null
  /** Its dependencies, each seen from this task: it `blocks` the other, is `waitingOn` it, or is `linked`. */
  dependencies?: { kind: 'blocks' | 'waitingOn' | 'linked'; task: TaskRef }[]
}

/** A task another one points at (a parent, a root, a dependency): enough to name and link it. */
export interface TaskRef {
  id: string
  number: string | null
  title: string
  url: string
  keyTask: boolean
  closed: boolean
}

export interface TaskCount {
  total: number
  open: number
}

/** PUT / DELETE /api/hosts/:host/sessions/:id/task — the session's manual task link after the change. */
export interface SessionTaskResponse {
  host: string
  id: string
  manualTask: { id: string | null } | null
}

/** GET /api/tasks */
export interface TasksResponse {
  source: 'productive'
  fetchedAt: number
  /** A refresh failed: this is the last answer, `error` says why. */
  stale: boolean
  error: string | null
  truncated: boolean
  count: number
  tasks: Task[]
}

/** One of a task's workflow statuses (GET /api/tasks/:id/statuses). */
export interface WorkflowStatus {
  id: string
  name: string
  category: 'notStarted' | 'started' | 'closed' | null
  /** A Productive palette name (lib/tasks.ts TASK_COLORS), like a task's `statusColor`. */
  color: string | null
  position: number | null
}

/** GET /api/tasks/:id/statuses — the statuses the task may move to (its project's workflow), in order. */
export interface TaskStatusesResponse {
  taskId: string
  projectId: string
  /** The task's current status id. */
  current: string | null
  statuses: WorkflowStatus[]
}

/** POST /api/tasks/:id/status `{ statusId }` — `changed: false` when it already was there. */
export interface ScratchpadState {
  text: string
  updatedAt: number | null
  exists: boolean
}

export interface TaskStatusChangeResponse {
  ok: true
  changed: boolean
  task: Task
}

/** POST /api/hosts/:host/prs/spawn */
export interface PrSpawnResponse {
  host: string
  worktree: PrWorktree
  spawn: SpawnResponse
}

/** A job run's outcome (docs/cli.md → Jobs). Unknown strings are possible from newer CLIs. */
export type JobOutcome = 'spawned' | 'skipped' | 'missed' | 'failed'

/** A session a run started (`parent`: the tmux session of the job session that spawned it; null = the run's first). */
export interface JobRunSession {
  tmuxSession: string
  name?: string | null
  parent: string | null
  /** Epoch ms. */
  at: number
  closedAt: number | null
}

export interface JobRun {
  id: string
  trigger: 'schedule' | 'manual' | string
  startedAt: number
  slot: number | null
  outcome: JobOutcome | string
  reason: string | null
  promptFile: string | null
  sessions: JobRunSession[]
}

/** A live session of a job (`fleet jobs --json` → `live[]`). */
export interface JobLive {
  run: string | null
  sessionId: string
  tmuxSession: string | null
  status: string
  title: string | null
}

/** One job (`fleet jobs --json` / `fleet jobs show <name> --json`) plus the host it lives on. */
export interface Job {
  host?: string
  name: string
  schedule: string
  /** The schedule in plain English ("Every day at 07:00"); absent from an older CLI. */
  scheduleText?: string
  enabled: boolean
  dir: string
  harness: string
  model: string | null
  command: string | null
  /** Seconds; null = never. */
  keep: number | null
  /**
   * A file prompt's `abs`: the path on the job's host (`~` expanded); `root`: its git checkout,
   * else its directory. `editorUrl` opens the file in the editor, `rootEditorUrl` the root (null
   * without an editor or an ssh alias). All absent from older servers.
   */
  prompt:
    | { inline: string }
    | { file: string; abs?: string; root?: string; editorUrl?: string | null; rootEditorUrl?: string | null }
    | null
  /** Epoch ms; null when paused (or the schedule never fires). */
  nextRun: number | null
  lastSlot: number | null
  /** Newest first: the latest one from the list, every kept run from `show`. */
  runs: JobRun[]
  live: JobLive[]
}

/** GET /api/hosts/:host/jobs */
export interface JobsResponse {
  host: string
  jobs: Job[]
}

/** POST /api/hosts/:host/jobs/:name/run */
export interface JobRunResponse {
  host: string
  name: string
  output: string
}

/** POST /api/hosts/:host/jobs/:name/enabled */
export interface JobEnabledResponse {
  host: string
  name: string
  enabled: boolean
  output: string
  job: Job | null
}
