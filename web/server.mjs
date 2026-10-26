#!/usr/bin/env node
// fleet-web — zero-dependency server for the fleet HTTP API + the bundled PWA.
// Config: the shared fleet config ($FLEET_CONFIG or ~/.config/fleet/config.json).
// See ARCHITECTURE.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { configPath, fleetStateDir, loadConfig, ensurePath, ensureUtf8Locale, resolveBinary } from './lib/config.mjs';
import { run } from './lib/run.mjs';
import { createFleetCli } from './lib/fleet-cli.mjs';
import { createFleet } from './lib/fleet.mjs';
import { createBackend } from './lib/backends.mjs';
import { createTranscriptReader, locateTranscript } from './lib/transcript.mjs';
import { createSpawner } from './lib/spawn.mjs';
import { createKiller } from './lib/kill.mjs';
import { createDeleter } from './lib/delete.mjs';
import { createServerStopper } from './lib/devservers.mjs';
import { createLeftovers } from './lib/leftovers.mjs';
import { createAutoNamer } from './lib/autoname.mjs';
import { createWorkspaceNamer } from './lib/workspaces.mjs';
import { createGrouper } from './lib/grouping.mjs';
import { createUploader } from './lib/uploads.mjs';
import { SPEECH_KEY_NAME, createKeySource, createSpeaker, createTranscriber } from './lib/transcribe.mjs';
import { createOperator } from './lib/operator.mjs';
import { createCompleter } from './lib/complete.mjs';
import { createFiles } from './lib/files.mjs';
import { createNotes } from './lib/notes.mjs';
import { createSpawnDirsEditor } from './lib/spawn-dirs.mjs';
import { createRepos } from './lib/repos.mjs';
import { createJobs } from './lib/jobs.mjs';
import { createTasks } from './lib/tasks.mjs';
import { createTouchedIndex } from './lib/touched.mjs';
import { createBriefExtractor } from './lib/brief-extract.mjs';
import { createBriefStore, createBriefs, createClaudeAsk, gitInfo } from './lib/briefs.mjs';
import { createStacks } from './lib/stacks.mjs';
import { fetchPeerHost } from './lib/peers.mjs';
import { createDormant } from './lib/dormant.mjs';
import { createTaskMentions } from './lib/mentions.mjs';
import { TASK_LINKS_FILE, createTaskLinks } from './lib/task-links.mjs';
import { SCRATCHPAD_FILE, createScratchpad } from './lib/scratchpad.mjs';
import { SQUAD_COUNTER_FILE, createSquadCounter } from './lib/squad.mjs';
import { createApi } from './lib/api.mjs';
import { createHttpServer } from './lib/app.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const NAME = 'fleet-web';
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const log = (line) => process.stdout.write(`${line}\n`);
const logError = (err, context = '') =>
  process.stderr.write(`[error]${context ? ` ${context}` : ''} ${err?.stack ?? String(err)}\n`);

ensurePath(process.env);
ensureUtf8Locale(process.env);

let config;
try {
  config = loadConfig({ env: process.env, webRoot: ROOT, log: console });
} catch (err) {
  process.stderr.write(`[fleet-web] ${err.message}\n`);
  process.exit(2);
}

const cli = createFleetCli({ run, bin: config.fleetBin });
const fleet = createFleet({ cli, self: config.self, ttlMs: 2000 });
const backend = createBackend({ run, tmux: config.tmux });
const autoNamer = createAutoNamer({
  cli,
  intervalMs: config.autoName.intervalMinutes * 60 * 1000,
  log,
});
// Sessions started in a new worktree: branch and title named after the work once it has answered.
const workspaceNamer = createWorkspaceNamer({
  cli,
  listSessions: async () => {
    const host = await fleet.localHost();
    return host.ok ? host.sessions : [];
  },
  log,
});
const uploader = createUploader({
  dir: config.uploads.dir,
  maxBytes: config.uploads.maxMB * 1024 * 1024,
  retentionDays: config.uploads.retentionDays,
  log,
});
// Only the grouping host runs the pass; the fleet accessors are bound once the API exists.
let fleetAccess = null;
const grouper = config.grouping.enabled
  ? createGrouper({
      cli,
      getFleet: () => fleetAccess.buildFleet(),
      peekFleet: () => fleetAccess.peekFleet(),
      self: config.self,
      intervalMs: config.grouping.intervalMinutes * 60 * 1000,
      log,
    })
  : null;
// Session briefs: GET/PUT always work; background generation only with web.briefs.enabled.
const briefs = createBriefs({
  settings: config.briefs,
  self: config.self,
  store: createBriefStore({ dir: config.briefs.dir }),
  extractor: createBriefExtractor({ locate: (cwd, id) => locateTranscript(cwd, id) }),
  listSessions: async () => {
    const host = await fleet.localHost();
    return host.ok ? host.sessions : null;
  },
  ask: createClaudeAsk({
    bin: resolveBinary('claude', { extraDirs: [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.claude', 'local')] }),
    run,
  }),
  git: (cwd) => gitInfo(cwd, { run }),
  log,
});
// Session stacks: the routes always work (the CLI owns the files); the background membership
// sync runs every web.stacks.syncMinutes while a session is in a stack (FLEET_WEB_STACKS=0: off).
const stacks = createStacks({
  cli,
  self: config.self,
  listSessions: async () => {
    const host = await fleet.localHost({ force: true });
    if (!host.ok) throw new Error(host.error);
    return host.sessions;
  },
  gateSessions: async () => {
    const host = await fleet.localHost();
    return host.ok ? host.sessions : null;
  },
  syncEnabled: config.stacks.sync,
  syncIntervalMs: config.stacks.syncMinutes * 60 * 1000,
  log,
});
// Session recovery: dormant sessions after a reboot (`fleet --local restore … --json`).
const dormant = createDormant({ cli, log });
// Voice: an OpenAI key for speech-to-text (voice prompts) and one for text-to-speech (the
// operator's replies) — OPENAI_TEXT_TO_SPEECH_API_KEY, else the transcription key.
const transcribeKey = createKeySource({ run });
const ttsKey = createKeySource({ name: SPEECH_KEY_NAME, run });
const speechKey = async () => (await ttsKey()) ?? (await transcribeKey());
const spawner = createSpawner({ run, tmux: config.tmux, launcher: config.claude, launchers: config.launchers });
const operator = createOperator({ config, fleet, spawner, backend, log });
const killer = createKiller({ run, tmux: config.tmux, closeIterm: (s) => backend.closeIterm(s) });
const handleApi = createApi({
  config,
  fleet,
  backend,
  transcripts: createTranscriptReader(),
  spawner,
  killer,
  // Delete also stops the dev servers started in the worktree and cleans their leftovers.
  deleter: createDeleter({
    run,
    killer,
    servers: createServerStopper({ run, tmux: config.tmux }),
    leftovers: createLeftovers({ run, home: os.homedir(), env: process.env }),
  }),
  cli,
  autoNamer,
  uploader,
  transcriber: createTranscriber({ getKey: transcribeKey, log }),
  speaker: createSpeaker({ getKey: speechKey, voice: config.operator.voice ?? undefined, log }),
  operator,
  files: createFiles({ home: os.homedir(), run, touched: createTouchedIndex(), roots: config.files.roots }),
  completer: createCompleter({ home: os.homedir(), run }),
  notes: createNotes({ config: config.notes, home: os.homedir(), run }),
  // Settings → Start directories: writes through `fleet config set`, hot-reloads config.spawnDirs.
  spawnDirs: createSpawnDirsEditor({ config, configFile: config.configFile ?? configPath(process.env), cli }),
  // Settings → Git repos: `fleet --local repos …` + `fleet config set repos`.
  repos: createRepos({ cli, configFile: config.configFile ?? configPath(process.env), self: config.self }),
  // Jobs screen: `fleet --local jobs …` (list / show / run now / enable|disable).
  jobs: createJobs({ cli, self: config.self }),
  // My tasks: Productive, with this server's token (web.tasks.productive / $PRODUCTIVE_AUTH_TOKEN).
  tasks: config.tasks ? createTasks({ settings: config.tasks, run, log }) : null,
  briefs,
  stacks,
  dormant,
  // Each live session's most-mentioned task URLs, counted from its transcript in the background.
  taskMentions: createTaskMentions({ logError }),
  // Sessions linked to a task by hand ("Link task…"), kept in fleet's state dir.
  taskLinks: createTaskLinks({ file: path.join(fleetStateDir(process.env), TASK_LINKS_FILE), logError }),
  scratchpad: createScratchpad({ file: path.join(fleetStateDir(process.env), SCRATCHPAD_FILE) }),
  // Madrid-palette spawns are named `<player> <n>`: the one counter, kept in fleet's state dir.
  squadCounter: createSquadCounter({ file: path.join(fleetStateDir(process.env), SQUAD_COUNTER_FILE) }),
  grouper,
  name: NAME,
  version: VERSION,
  logError,
});

fleetAccess = handleApi;

const server = createHttpServer({ handleApi, uiDir: config.uiDir, log, logError });

server.on('error', (err) => {
  logError(err, 'server');
  process.exit(1);
});

server.listen(config.port, config.bind, () => {
  log(`[fleet-web] self=${config.self} listening on http://${config.bind}:${config.port}`);
  log(`[fleet-web] config=${config.configFile ?? '(none, defaults)'} peers=${Object.keys(config.peers).join(',') || '(none)'}`);
  log(`[fleet-web] fleet=${config.fleetBin} tmux=${config.tmux} ui=${config.uiDir ?? '(none)'}`);
  if (config.autoName.enabled) {
    autoNamer.start();
    log(`[fleet-web] autoname every ${config.autoName.intervalMinutes}m (fleet name --all --apply)`);
  } else {
    log('[fleet-web] autoname off (web.autoName.enabled = false)');
  }
  workspaceNamer.start();
  uploader.start();
  // A running operator keeps its workspace current (its ./api helper names this server's port).
  operator.prepare().catch((err) => logError(err, 'operator workspace'));
  operator.start();
  if (config.operator.clearIdleMinutes) log(`[fleet-web] operator: /clear after ${config.operator.clearIdleMinutes}m idle`);
  log(config.tasks ? `[fleet-web] tasks: Productive (${config.tasks.keychain ? 'Keychain item' : '$PRODUCTIVE_AUTH_TOKEN'})` : '[fleet-web] tasks off (web.tasks.productive unset)');
  log(`[fleet-web] uploads ${config.uploads.dir} (max ${config.uploads.maxMB} MB, kept ${config.uploads.retentionDays || '∞'} days)`);
  if (grouper) {
    grouper.start();
    log(`[fleet-web] grouping every ${config.grouping.intervalMinutes}m (fleet group, all hosts)`);
  } else if (config.grouping.host && config.grouping.host !== config.self) {
    log(`[fleet-web] grouping: served by ${config.grouping.host}`);
  } else {
    log('[fleet-web] grouping off (web.grouping.enabled = false)');
  }
  if (config.briefs.enabled) {
    briefs.start();
    const b = config.briefs;
    log(`[fleet-web] briefs on (${b.dir}; ${b.model}, idle ${b.idleMs / 1000}s, every ≥ ${b.minIntervalMs / 60000}m per session, ≤ ${b.maxCallsPerHour}/h)`);
  } else {
    log(`[fleet-web] briefs: background generation off (web.briefs.enabled = false); ${config.briefs.dir}`);
  }
  // The sync judges members on other hosts with the merged fleet (the warm snapshot when someone
  // is watching, else one fresh build); a sibling started on a peer is found in that peer's list.
  stacks.attach({
    fleetBody: async () => handleApi.peekFleet() ?? (await handleApi.buildFleet()),
    peerSessions: async (name) => {
      const url = config.peers[name];
      if (!url) return null;
      const h = await fetchPeerHost(name, url, { timeoutMs: 6000 });
      return h.ok ? h.sessions : null;
    },
  });
  stacks.start();
  log(config.stacks.sync
    ? `[fleet-web] stacks: sync every ${config.stacks.syncMinutes}m while a session is in a stack (fleet stack sync)`
    : '[fleet-web] stacks: background sync off (FLEET_WEB_STACKS=0)');
  if (config.restore.onBoot) {
    log('[fleet-web] restore.onBoot: bringing back dormant sessions (fleet restore --all)');
    dormant.restoreOnBoot({ markerFile: config.restore.markerFile }).then((r) => {
      if (r?.restored?.length) handleApi.refreshFleet();
    });
  }
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`[fleet-web] ${signal} received, shutting down`);
  autoNamer.stop();
  workspaceNamer.stop();
  grouper?.stop();
  briefs.stop();
  stacks.stop();
  operator.stop();
  uploader.stop();
  handleApi.stop();
  const timer = setTimeout(() => process.exit(0), 3000);
  timer.unref?.();
  server.close(() => {
    log('[fleet-web] closed');
    process.exit(0);
  });
  server.closeIdleConnections?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => logError(err, 'uncaughtException'));
process.on('unhandledRejection', (err) => logError(err, 'unhandledRejection'));
