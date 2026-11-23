// Network layer. Normally this talks to the same Firebase Realtime Database
// as the Death Note game (rooms live under /rooms, tagged edition:
// 'werewolves' so the two games never mix up each other's room codes).
//
// Adding ?local to the URL swaps in a fake database kept in localStorage and
// synced between tabs of one browser. That's handy for testing on a single
// computer with several tabs open as different players.

const LOCAL = new URLSearchParams(location.search).has('local');

let impl;

if (LOCAL) {
  const KEY = 'ww_localdb';
  const chan = new BroadcastChannel('ww_localdb');
  const listeners = new Set();
  const read = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const write = (tree) => {
    localStorage.setItem(KEY, JSON.stringify(tree));
    chan.postMessage('changed');
    setTimeout(fire, 0);
  };
  const getAt = (tree, path) => path.split('/').filter(Boolean).reduce((n, k) => (n == null ? undefined : n[k]), tree);
  const clean = (v) => {
    // Mimic Firebase: nulls, empty objects and empty arrays disappear.
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) { const o = {}; v.forEach((x, i) => { const c = clean(x); if (c !== undefined) o[i] = c; }); return Object.keys(o).length ? o : undefined; }
    if (typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => { const c = clean(v[k]); if (c !== undefined) o[k] = c; }); return Object.keys(o).length ? o : undefined; }
    return v;
  };
  const setAt = (tree, path, val) => {
    const parts = path.split('/').filter(Boolean);
    let n = tree;
    parts.slice(0, -1).forEach(k => { if (typeof n[k] !== 'object' || n[k] === null) n[k] = {}; n = n[k]; });
    const c = clean(JSON.parse(JSON.stringify(val === undefined ? null : val)));
    if (c === undefined) delete n[parts[parts.length - 1]]; else n[parts[parts.length - 1]] = c;
  };
  const fire = () => {
    const tree = read();
    listeners.forEach(l => {
      const v = getAt(tree, l.path);
      const s = JSON.stringify(v === undefined ? null : v);
      if (s !== l.last) { l.last = s; l.cb(v === undefined ? null : JSON.parse(s)); }
    });
  };
  chan.onmessage = fire;
  let uid = sessionStorage.getItem('ww_local_uid');
  if (!uid) { uid = 'u' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('ww_local_uid', uid); }

  impl = {
    local: true,
    async signIn() { return uid; },
    async get(path) { const v = getAt(read(), path); return v === undefined ? null : v; },
    async set(path, val) { const t = read(); setAt(t, path, val); write(t); },
    async update(path, vals) { const t = read(); Object.keys(vals).forEach(k => setAt(t, path + '/' + k, vals[k])); write(t); },
    async transaction(path, fn) {
      const t = read();
      const cur = getAt(t, path);
      const next = fn(cur === undefined ? null : JSON.parse(JSON.stringify(cur)));
      if (next === undefined) return { committed: false, value: cur };
      setAt(t, path, next); write(t);
      const v = getAt(read(), path);
      return { committed: true, value: v === undefined ? null : v };
    },
    listen(path, cb) {
      const l = { path, cb, last: undefined };
      listeners.add(l);
      setTimeout(fire, 0);
      return () => listeners.delete(l);
    },
  };
} else {
  const fb = await import('../firebase-init.js');
  impl = {
    local: false,
    signIn() {
      return new Promise((resolve, reject) => {
        fb.onAuthStateChanged(fb.auth, (user) => {
          if (user) resolve(user.uid);
          else fb.signInAnonymously(fb.auth).catch(reject);
        });
      });
    },
    async get(path) { const s = await fb.get(fb.ref(fb.db, path)); return s.exists() ? s.val() : null; },
    set(path, val) { return fb.set(fb.ref(fb.db, path), val); },
    update(path, vals) { return fb.update(fb.ref(fb.db, path), vals); },
    async transaction(path, fn) {
      const res = await fb.runTransaction(fb.ref(fb.db, path), fn);
      return { committed: res.committed, value: res.snapshot.val() };
    },
    listen(path, cb) { return fb.onValue(fb.ref(fb.db, path), s => cb(s.val()), err => console.error(err)); },
  };
}

export const net = impl;
