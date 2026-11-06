import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { stateStore } from './state-store.js';
import { createHash } from 'node:crypto';
// Parsed records only: logs need metadata checks, not full reads on every refresh.
// A persistent copy allows unchanged historical logs to survive container restarts.
export class ParsedFileCache {
  constructor(
    namespace,
    { persistent = true, limit = 8192, maxBytes = 64 * 1024 * 1024 } = {},
  ) {
    this.namespace = namespace;
    this.persistent = persistent;
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.entries = new Map();
    this.pending = new Map();
  }
  forget(file) {
    const entry = this.entries.get(file);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(file);
  }
  remember(file, stamp, value) {
    this.forget(file);
    const bytes = 1024 + 2 * Buffer.byteLength(JSON.stringify(value));
    this.entries.set(file, { stamp, value, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.limit || this.bytes > this.maxBytes)
      this.forget(this.entries.keys().next().value);
  }
  archived(file) {
    return this.persistent
      ? stateStore().cached(this.namespace, file)?.value
      : null;
  }
  files(roots) {
    return this.persistent ? stateStore().files(this.namespace, roots) : [];
  }
  async get(file, loader, accepts = () => true) {
    if (this.pending.has(file)) return this.pending.get(file);
    const task = this.load(file, loader, accepts).finally(() =>
      this.pending.delete(file),
    );
    this.pending.set(file, task);
    return task;
  }
  async load(file, loader, accepts) {
    let before;
    try {
      before = await stat(file);
    } catch {
      this.forget(file);
      return null;
    }
    if (!before.isFile()) {
      this.forget(file);
      return null;
    }
    const identity = (s) =>
      `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
    const stamp = identity(before),
      hit = this.entries.get(file);
    if (hit?.stamp === stamp && accepts(hit.value)) {
      this.entries.delete(file);
      this.entries.set(file, hit);
      return hit.value;
    }
    const digest = createHash('sha256')
      .update(`${this.namespace}|${file}`)
      .digest('hex');
    const disk = path.join(
      process.env.STATE_DIR || '/data/state',
      'parsed',
      `${digest}.json`,
    );
    let value,
      loaded = false;
    if (this.persistent)
      try {
        let saved = stateStore().cached(this.namespace, file);
        if (!saved) {
          // Lazy migration from the prior JSON cache, without deleting it.
          try {
            saved = JSON.parse(await readFile(disk, 'utf8'));
          } catch {}
          if (saved?.stamp === stamp)
            stateStore().cache(this.namespace, file, stamp, saved.value);
        }
        if (saved?.stamp === stamp && accepts(saved.value)) {
          value = saved.value;
          loaded = true;
        }
      } catch {}
    if (!loaded) value = await loader(file);
    const after = await stat(file).catch(() => null);
    if (!after || identity(after) !== stamp) return value;
    this.remember(file, stamp, value);
    if (this.persistent && !loaded)
      try {
        stateStore().cache(this.namespace, file, stamp, value);
      } catch {
        /* Cache persistence is optional; quota state reports its own errors. */
      }
    return value;
  }
}
