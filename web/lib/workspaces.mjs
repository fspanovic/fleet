// The workspace namer. A session started in a new worktree (`fleet spawn --worktree`, or the
// web's New session → "New worktree") is called after its handle (`ballyhoo`) and sits on the
// branch `<prefix>/<handle>`. Once its first prompt has been answered, this names it after the
// work: `fleet workspace name <id> --json` generates a slug from that prompt (the naming model,
// as `fleet name`), renames the branch to `<prefix>/<slug>` when that is safe (fleet made it,
// never pushed, the name is free) and sets the session title through the same `/rename` path
// as `fleet rename`. The handle stays the folder name and a label on the rows.
//
// It watches this host's `fleet list --json` rows: a row with `workspace.named === false`,
// a first prompt (`title`) and `status: "idle"` is due (not `"shell"`: a background task still
// running is live work, and naming types `/rename` into the session). That covers sessions the CLI spawned too, not only web spawns. One call at a time; a
// session is tried at most `maxTries` times (held / no prompt yet / a failed call), then left to
// `fleet workspace name`.

/** Is this `list --json` row a workspace session whose first prompt has been answered? */
export function workspaceNameDue(row) {
  return Boolean(
    row &&
      row.workspace &&
      row.workspace.named === false &&
      typeof row.session_id === 'string' &&
      row.session_id &&
      typeof row.title === 'string' &&
      row.title.trim() &&
      row.status === 'idle',
  );
}

/**
 * @param deps
 *   cli          lib/fleet-cli.mjs instance (`workspaceName`)
 *   listSessions () => Promise<row[]> — this host's `fleet list --json` rows
 *   intervalMs, maxTries, log
 */
export function createWorkspaceNamer({ cli, listSessions, intervalMs = 10 * 1000, maxTries = 8, log = () => {} }) {
  if (!cli || typeof cli.workspaceName !== 'function') throw new TypeError('cli.workspaceName must be a function');
  if (typeof listSessions !== 'function') throw new TypeError('listSessions must be a function');
  const tries = new Map(); // session id -> attempts so far
  let timer = null;
  let inFlight = null;
  let stopped = true;

  /** One pass: name every due session (in turn). Resolves [{ id, result, message }]. */
  async function tick() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const done = [];
      let rows = [];
      try {
        rows = await listSessions();
      } catch {
        return done;
      }
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!workspaceNameDue(row)) continue;
        const id = row.session_id;
        const n = tries.get(id) ?? 0;
        if (n >= maxTries) continue;
        tries.set(id, n + 1);
        try {
          const r = await cli.workspaceName({ target: id });
          done.push({ id, result: r?.result ?? null, message: r?.message ?? '' });
          const branch = r?.branch?.note ? ` · branch: ${r.branch.note}` : '';
          log(`[workspace] ${row.workspace.handle}: ${r?.result ?? '?'} — ${r?.message ?? ''}${branch}`);
          if (r?.ok) tries.delete(id);
        } catch (err) {
          done.push({ id, result: 'error', message: err?.message ?? String(err) });
          log(`[workspace] ${row.workspace.handle}: try ${n + 1} failed: ${err?.message ?? err}`);
        }
      }
      return done;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, intervalMs);
    timer.unref?.();
  }

  return {
    start() {
      stopped = false;
      schedule();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    tick,
  };
}
