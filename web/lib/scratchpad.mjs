import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { HttpError } from './http.mjs';

export const SCRATCHPAD_FILE = 'scratchpad.txt';
export const SCRATCHPAD_MAX_CHARS = 512 * 1024;
export const SCRATCHPAD_BODY_LIMIT = 4 * SCRATCHPAD_MAX_CHARS + 4096;

export function validateScratchpadPut(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('body must be { text, baseUpdatedAt }', 400);
  if (typeof body.text !== 'string') throw new HttpError('text must be a string', 400);
  if (!('baseUpdatedAt' in body)) throw new HttpError('baseUpdatedAt is required (the updatedAt you started from, null when there was no scratchpad)', 400);
  const base = body.baseUpdatedAt;
  if (base !== null && !(Number.isFinite(base) && base >= 0)) throw new HttpError('baseUpdatedAt must be a number or null', 400);
  if (body.text.length > SCRATCHPAD_MAX_CHARS) throw new HttpError(`scratchpad too large (max ${SCRATCHPAD_MAX_CHARS} characters)`, 413);
  return { text: body.text, base };
}

export function validateScratchpadAppend(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.text !== 'string') throw new HttpError('body must be { text }', 400);
  const text = body.text.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
  if (!text.trim()) throw new HttpError('text must not be blank', 400);
  return text;
}

export function appendParagraph(current, note) {
  if (!current) return note;
  const sep = current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
  return current + sep + note;
}

export function createScratchpad({ file, now = Date.now }) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new TypeError('scratchpad file must be an absolute path');
  let queue = Promise.resolve();

  function serial(fn) {
    const next = queue.catch(() => {}).then(fn);
    queue = next.catch(() => {});
    return next;
  }

  async function read() {
    let st;
    let text;
    try {
      st = await fsp.stat(file);
      text = await fsp.readFile(file, 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') return { text: '', updatedAt: null, exists: false };
      throw err;
    }
    return { text, updatedAt: Math.round(st.mtimeMs), exists: true };
  }

  async function write(text, prev) {
    const updatedAt = Math.max(now(), (prev ?? 0) + 1);
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      await fsp.writeFile(tmp, text, { mode: 0o600 });
      const at = new Date(updatedAt);
      await fsp.utimes(tmp, at, at);
      await fsp.rename(tmp, file);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
    return read();
  }

  return {
    file,
    get: read,
    put: (text, base) =>
      serial(async () => {
        const cur = await read();
        if (cur.exists && cur.text === text) return { ok: true, value: cur };
        if (base !== cur.updatedAt) return { ok: false, value: cur };
        return { ok: true, value: await write(text, cur.updatedAt) };
      }),
    append: (note) =>
      serial(async () => {
        const cur = await read();
        return write(appendParagraph(cur.text, note), cur.updatedAt);
      }),
  };
}
