/* Image bytes only. Message delivery, polling, notifications and service workers are not cached here. */
(function (root) {
  'use strict';

  function create(options) {
    options = options || {};
    const storage = options.storage;
    const now = options.now || Date.now;
    const ttl = options.ttl || 7 * 24 * 60 * 60 * 1000;
    const maxBytes = options.maxBytes || 16 * 1024 * 1024;
    let state;
    function fresh(scope) {
      return { scope, approved: new Set(), versions: new Map(), memory: new Map(), pending: new Map(), bytes: 0 };
    }
    state = fresh('');
    function background(method, ...args) {
      if (storage && storage[method]) Promise.resolve().then(() => storage[method](...args)).catch(() => {});
    }
    function remember(s, key, value) {
      const previous = s.memory.get(key);
      if (previous) s.bytes -= previous.value.image.length;
      s.memory.delete(key);
      if (value.value.image.length <= maxBytes) {
        s.memory.set(key, value);
        s.bytes += value.value.image.length;
      }
      while (s.bytes > maxBytes) {
        const oldest = s.memory.keys().next().value;
        s.bytes -= s.memory.get(oldest).value.image.length;
        s.memory.delete(oldest);
      }
    }
    function valid(entry) {
      return entry && entry.value && entry.value.ok && typeof entry.value.image === 'string' &&
        entry.value.image && now() - entry.at < ttl;
    }
    function stale() {
      const error = new Error('图片访问状态已变化');
      error.code = 'MEDIA_STALE';
      return error;
    }
    const api = {
      setScope(scope) {
        scope = scope || '';
        if (state.scope === scope) return;
        const previous = state.scope;
        state = fresh(scope);
        if (previous) background('clearScope', previous);
      },
      approve(key) { if (state.scope) state.approved.add(key); },
      reconcile(prefix, keys) {
        const keep = new Set(keys);
        for (const key of state.approved) {
          if (key.startsWith(prefix) && !keep.has(key)) api.invalidate(key);
        }
        keep.forEach(key => api.approve(key));
      },
      invalidate(key) {
        state.approved.delete(key);
        state.versions.set(key, (state.versions.get(key) || 0) + 1);
        state.pending.delete(key);
        const old = state.memory.get(key);
        if (old) state.bytes -= old.value.image.length;
        state.memory.delete(key);
        if (state.scope) background('remove', state.scope, key);
      },
      seed(key, value) {
        if (!state.scope || !value || !value.ok || !value.image) return;
        const entry = { at: now(), value };
        api.approve(key);
        remember(state, key, entry);
        background('put', state.scope, key, entry);
      },
      load(key, loader) {
        const s = state;
        if (!s.scope) return Promise.resolve().then(loader);
        const version = s.versions.get(key) || 0;
        const isCurrent = () => state === s && (s.versions.get(key) || 0) === version;
        if (s.pending.has(key)) return s.pending.get(key);
        const reusable = s.approved.has(key);
        const memory = reusable && s.memory.get(key);
        if (valid(memory)) {
          remember(s, key, memory);
          return Promise.resolve().then(() => {
            if (!isCurrent()) throw stale();
            return memory.value;
          });
        }
        const request = (async () => {
          if (reusable && storage) {
            let entry;
            try { entry = await storage.get(s.scope, key); } catch (_) {}
            if (!isCurrent()) throw stale();
            if (s.approved.has(key) && valid(entry)) {
              remember(s, key, entry);
              return entry.value;
            }
          }
          const value = await loader();
          if (!isCurrent()) throw stale();
          if (value && value.ok && value.image) api.seed(key, value);
          return value;
        })();
        s.pending.set(key, request);
        const cleanup = () => { if (s.pending.get(key) === request) s.pending.delete(key); };
        request.then(cleanup, cleanup);
        return request;
      }
    };
    return api;
  }

  // Separate metadata keeps quota pruning from reading every stored base64 image.
  // IndexedDB unavailable/blocked/quota errors fall back to the existing network path.
  function createStorage(env) {
    env = env || root;
    try {
      if (!env.indexedDB || !env.crypto || !env.crypto.subtle || !env.TextEncoder) return null;
    } catch (_) { return null; }
    const maxBytes = 32 * 1024 * 1024;
    const ttl = 7 * 24 * 60 * 60 * 1000;
    const hashes = new Map();
    let database;
    function digest(scope) {
      if (!hashes.has(scope)) {
        const task = env.crypto.subtle.digest('SHA-256', new env.TextEncoder().encode(scope))
          .then(bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join(''));
        hashes.set(scope, task);
        if (hashes.size > 4) hashes.delete(hashes.keys().next().value);
      }
      return hashes.get(scope);
    }
    function open() {
      if (!database) database = new Promise((resolve, reject) => {
        const request = env.indexedDB.open('blys_chat_media_v1', 1);
        const timer = setTimeout(() => reject(new Error('media database timeout')), 250);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('images');
          const metadata = db.createObjectStore('metadata', { keyPath: 'key' });
          metadata.createIndex('scope', 'scope');
        };
        request.onsuccess = () => {
          clearTimeout(timer);
          const db = request.result;
          db.onversionchange = () => { db.close(); database = null; };
          resolve(db);
        };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        request.onblocked = () => { clearTimeout(timer); reject(new Error('media database blocked')); };
      });
      return database;
    }
    async function transaction(scope, mode, operation) {
      const [db, hash] = await Promise.all([open(), digest(scope)]);
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['images', 'metadata'], mode);
        let result;
        const timer = setTimeout(() => { try { tx.abort(); } catch (_) {} reject(new Error('media storage timeout')); }, 250);
        tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
        tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(tx.error || new Error('media storage aborted')); };
        operation(tx.objectStore('images'), tx.objectStore('metadata'), hash, value => { result = value; });
      });
    }
    return {
      get(scope, key) {
        return transaction(scope, 'readonly', (images, _, hash, done) => {
          images.get(hash + ':' + key).onsuccess = event => done(event.target.result);
        });
      },
      put(scope, key, entry) {
        // Uploaded chat images have a 650 KB limit; do not persist unexpectedly large payloads.
        if (entry.value.image.length > 1000000) return Promise.resolve();
        return transaction(scope, 'readwrite', (images, metadata, hash) => {
          const id = hash + ':' + key;
          images.put(entry, id);
          metadata.put({ key: id, scope: hash, at: entry.at, bytes: entry.value.image.length });
          metadata.getAll().onsuccess = event => {
            const rows = event.target.result.sort((a, b) => b.at - a.at);
            let bytes = 0;
            rows.forEach(row => {
              bytes += row.bytes;
              if (bytes > maxBytes || Date.now() - row.at >= ttl) {
                images.delete(row.key);
                metadata.delete(row.key);
              }
            });
          };
        });
      },
      remove(scope, key) {
        return transaction(scope, 'readwrite', (images, metadata, hash) => {
          images.delete(hash + ':' + key);
          metadata.delete(hash + ':' + key);
        });
      },
      clearScope(scope) {
        return transaction(scope, 'readwrite', (images, metadata, hash) => {
          metadata.index('scope').openCursor(hash).onsuccess = event => {
            const cursor = event.target.result;
            if (!cursor) return;
            images.delete(cursor.primaryKey);
            cursor.delete();
            cursor.continue();
          };
        });
      }
    };
  }
  root.BlysMediaCache = { create, createStorage };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BlysMediaCache;
})(typeof window !== 'undefined' ? window : globalThis);
