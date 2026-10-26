// Madrid-palette spawns: the session is named after the player it gets plus the next number of one
// counter (`Kovačić 27`, tmux `kovacic-27`). The counter never resets or reuses a number; it lives in
// fleet's state dir (squad-counter.json).
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { sanitizeName } from './spawn.mjs';

export const SQUAD_COUNTER_FILE = 'squad-counter.json';

/** `Kovačić 27`: what Claude is named (`-n`), so the title. */
export const squadTitle = (player, n) => `${player} ${n}`;

/** `kovacic-27`: the tmux name, the same slug `core::title::tmux_name_for` derives from the title. */
export const squadTmuxName = (title) => sanitizeName(String(title).normalize('NFD').replace(/\p{M}+/gu, ''));

export function createSquadCounter({ file }) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new TypeError('squad counter file must be an absolute path');
  let queue = Promise.resolve();

  async function readLast() {
    try {
      const last = JSON.parse(await fsp.readFile(file, 'utf8'))?.last;
      return Number.isSafeInteger(last) && last > 0 ? last : 0;
    } catch (err) {
      if (err?.code === 'ENOENT') return 0;
      throw err;
    }
  }

  async function write(last) {
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      await fsp.writeFile(tmp, `${JSON.stringify({ version: 1, last })}\n`, { mode: 0o600 });
      await fsp.rename(tmp, file);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  /** The next number, persisted before it is handed out. */
  function next() {
    const run = queue.catch(() => {}).then(async () => {
      const n = (await readLast()) + 1;
      await write(n);
      return n;
    });
    queue = run.catch(() => {});
    return run;
  }

  return { file, next, last: () => queue.catch(() => {}).then(readLast) };
}
