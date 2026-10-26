// Dev-environment leftovers of a deleted worktree, cleaned after it is removed (lib/delete.mjs):
//
//   fe-live-env   state files of a local frontend env (`fe-live-env`, the Productive frontend's
//                 per-branch dev server) whose record points at the worktree:
//                 <state>/<suffix>.json, <suffix>.pid and the port locks ports/*.lock it owns —
//                 only when no holder of the env is alive any more and its server is gone.
//                 <state> = $FE_LIVE_ENV_WORK_ROOT/output/fe-live-env ($HOME/productive/work).
//   puma-dev      ~/.puma-dev/app-*.productive.io host files: a port file on a port one of the
//                 stopped servers listened on (or the env's recorded host file, when it still
//                 holds the env's port), once nothing listens there; a symlink into the worktree.
//   watchman      watched roots inside the worktree (`watchman watch-del`); a watchman server
//                 that is not running is never started (`--no-spawn`).
//
// Each part is skipped silently when its directory or binary is missing, so hosts without these
// tools see nothing. Nothing outside those two directories and watchman is touched.
import fsp from 'node:fs/promises';
import path from 'node:path';

import { isInside } from './devservers.mjs';

const PUMA_APP = /^app-.+\.productive\.io$/;
const WATCHMAN_MS = 10 * 1000;

const errLine = (err) => String(err?.message ?? err).trim().split('\n')[0] || 'failed';

function isAliveWith(killProcess) {
  return (pid) => {
    if (!Number.isInteger(pid) || pid <= 1) return false;
    try {
      killProcess(pid, 0);
      return true;
    } catch (err) {
      return err?.code === 'EPERM';
    }
  };
}

/**
 * @param deps
 *   run          execFile wrapper (lib/run.mjs)
 *   home         $HOME
 *   env          process.env (FE_LIVE_ENV_WORK_ROOT)
 *   fs           { readdir, readFile, lstat, readlink, unlink } (node:fs/promises; injected for tests)
 *   killProcess  process.kill (liveness checks only: signal 0)
 *   realpath     fs.realpath
 *   watchman     watchman binary
 */
export function createLeftovers({ run, home, env = {}, fs = fsp, killProcess = process.kill.bind(process), realpath = fsp.realpath, watchman = 'watchman' }) {
  if (typeof run !== 'function') throw new TypeError('run must be a function');
  if (!home) throw new TypeError('home is required');
  const alive = isAliveWith(killProcess);
  const feDir = path.join(env.FE_LIVE_ENV_WORK_ROOT || path.join(home, 'productive', 'work'), 'output', 'fe-live-env');
  const pumaDir = path.join(home, '.puma-dev');

  const canonical = async (p) => {
    try {
      return await realpath(p);
    } catch {
      return path.resolve(p);
    }
  };
  const list = async (dir) => {
    try {
      return await fs.readdir(dir);
    } catch {
      return null; // missing: this part is skipped
    }
  };
  const readJson = async (file) => {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      return null;
    }
  };

  /** fe-live-env records whose worktree is `worktree` → [{ suffix, port, pid, holders, pumaFile }]. */
  async function feEnvs(worktree) {
    const names = await list(feDir);
    if (!names) return [];
    const out = [];
    for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
      const rec = await readJson(path.join(feDir, name));
      if (!rec || typeof rec.worktree !== 'string') continue;
      if (rec.worktree !== worktree && (await canonical(rec.worktree)) !== worktree) continue;
      const pumaFile = typeof rec.pumaDevHostFile === 'string' && path.dirname(rec.pumaDevHostFile) === pumaDir && PUMA_APP.test(path.basename(rec.pumaDevHostFile)) ? rec.pumaDevHostFile : null;
      out.push({
        suffix: name.slice(0, -'.json'.length),
        port: Number.isInteger(rec.port) ? rec.port : null,
        pid: Number.isInteger(rec.pid) ? rec.pid : null,
        holders: (Array.isArray(rec.holders) ? rec.holders : []).filter((h) => Number.isInteger(h?.pid)),
        pumaFile,
      });
    }
    return out;
  }

  /** Why an env must stay: a holder or its server still alive and not going away. null = it can go. */
  function feBlocker(env, going) {
    const holder = env.holders.find((h) => alive(h.pid) && !going.has(h.pid));
    if (holder) return `held by ${holder.fleetSession?.name ?? holder.id ?? `pid ${holder.pid}`} (pid ${holder.pid})`;
    if (env.pid && alive(env.pid) && !going.has(env.pid)) return `its server (pid ${env.pid}) is still running`;
    return null;
  }

  /** puma-dev app-* entries for the worktree → [{ name, file, port, link }]. */
  async function pumaEntries(worktree, ports, envs) {
    const names = await list(pumaDir);
    if (!names) return [];
    const recorded = new Map(envs.filter((e) => e.pumaFile && e.port).map((e) => [path.basename(e.pumaFile), e.port]));
    const out = [];
    for (const name of names.filter((n) => PUMA_APP.test(n)).sort()) {
      const file = path.join(pumaDir, name);
      let st;
      try {
        st = await fs.lstat(file);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        try {
          const target = path.resolve(pumaDir, await fs.readlink(file));
          if (isInside(target, worktree) || isInside(await canonical(target), worktree)) out.push({ name, file, port: null, link: target });
        } catch {
          /* unreadable link: not ours to judge */
        }
        continue;
      }
      if (!st.isFile() || st.size > 64) continue;
      let port;
      try {
        port = Number(String(await fs.readFile(file, 'utf8')).trim());
      } catch {
        continue;
      }
      if (!Number.isInteger(port) || port <= 0) continue;
      if (ports.has(port) || recorded.get(name) === port) out.push({ name, file, port, link: null });
    }
    return out;
  }

  /** Watched roots inside the worktree; [] when watchman is missing or not running. */
  async function watchRoots(worktree) {
    try {
      const { stdout } = await run(watchman, ['--no-spawn', 'watch-list'], { timeout: WATCHMAN_MS });
      const roots = JSON.parse(stdout).roots;
      return (Array.isArray(roots) ? roots : []).filter((r) => typeof r === 'string' && isInside(r, worktree)).sort();
    } catch {
      return [];
    }
  }

  /**
   * What would be cleaned for `worktree`, given the pids that go (the session's and the servers
   * Delete stops) and the ports those servers listen on. Changes nothing.
   * → [{ kind: 'fe-live-env' | 'puma-dev' | 'watchman', name, port, keep }] — `keep`: why it
   * will be left (null = it goes)
   */
  async function plan({ worktree, going = new Set(), ports = new Set() }) {
    const envs = await feEnvs(worktree);
    const [puma, roots] = await Promise.all([pumaEntries(worktree, ports, envs), watchRoots(worktree)]);
    const feItems = envs.map((e) => ({ kind: 'fe-live-env', name: e.suffix, port: e.port, keep: feBlocker(e, going) }));
    const keptFiles = new Set(envs.filter((e, i) => feItems[i].keep && e.pumaFile).map((e) => path.basename(e.pumaFile)));
    return [
      ...feItems,
      ...puma.map((p) => ({ kind: 'puma-dev', name: p.name, port: p.port, keep: keptFiles.has(p.name) ? 'its fe-live-env stays' : null })),
      ...roots.map((r) => ({ kind: 'watchman', name: r, port: null, keep: null })),
    ];
  }

  const unlink = async (file) => {
    try {
      await fs.unlink(file);
      return true;
    } catch (err) {
      if (err?.code === 'ENOENT') return false;
      throw err;
    }
  };

  /**
   * Clean them, after the servers are stopped and the worktree is removed. `ports`: what the
   * stopped servers listened on; `listening`: the ports something listens on now (null =
   * unknown: port files are then kept).
   * → [{ kind, name, result: 'removed' | 'kept' | 'failed', note }]
   */
  async function clean({ worktree, ports = new Set(), listening = null }) {
    const out = [];
    const envs = await feEnvs(worktree);
    for (const e of envs) {
      const blocker = feBlocker(e, new Set());
      if (blocker) {
        out.push({ kind: 'fe-live-env', name: e.suffix, result: 'kept', note: blocker });
        continue;
      }
      try {
        const removed = [];
        for (const f of [`${e.suffix}.json`, `${e.suffix}.pid`]) if (await unlink(path.join(feDir, f))) removed.push(f);
        const portsDir = path.join(feDir, 'ports');
        for (const f of ((await list(portsDir)) ?? []).filter((n) => n.endsWith('.lock')).sort()) {
          const lock = await readJson(path.join(portsDir, f));
          if (lock?.suffix === e.suffix && !(Number.isInteger(lock.pid) && alive(lock.pid)) && (await unlink(path.join(portsDir, f)))) removed.push(`ports/${f}`);
        }
        out.push({ kind: 'fe-live-env', name: e.suffix, result: 'removed', note: removed.join(', ') || null });
      } catch (err) {
        out.push({ kind: 'fe-live-env', name: e.suffix, result: 'failed', note: errLine(err) });
      }
    }
    // An env that stays keeps its host file.
    const keptFiles = new Set(out.filter((r) => r.result === 'kept').flatMap((r) => envs.filter((e) => e.suffix === r.name && e.pumaFile).map((e) => path.basename(e.pumaFile))));
    for (const p of await pumaEntries(worktree, ports, envs)) {
      if (keptFiles.has(p.name)) {
        out.push({ kind: 'puma-dev', name: p.name, result: 'kept', note: 'its fe-live-env stays' });
        continue;
      }
      if (p.port !== null && (listening === null || listening.has(p.port))) {
        out.push({ kind: 'puma-dev', name: p.name, result: 'kept', note: listening === null ? `could not check port ${p.port}` : `port ${p.port} still has a listener` });
        continue;
      }
      try {
        await unlink(p.file);
        out.push({ kind: 'puma-dev', name: p.name, result: 'removed', note: p.port !== null ? `port ${p.port}` : `→ ${p.link}` });
      } catch (err) {
        out.push({ kind: 'puma-dev', name: p.name, result: 'failed', note: errLine(err) });
      }
    }
    for (const root of await watchRoots(worktree)) {
      try {
        const { stdout } = await run(watchman, ['--no-spawn', 'watch-del', root], { timeout: WATCHMAN_MS });
        const ok = /"watch-del":\s*true/.test(stdout ?? '');
        out.push({ kind: 'watchman', name: root, result: ok ? 'removed' : 'failed', note: ok ? null : String(stdout ?? '').trim().slice(0, 200) || 'watch-del did not confirm' });
      } catch (err) {
        out.push({ kind: 'watchman', name: root, result: 'failed', note: errLine(err) });
      }
    }
    return out;
  }

  return { plan, clean };
}
