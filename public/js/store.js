import { useEffect, useState } from 'preact/hooks';

// 画面全体の状態。変更は1フレームにまとめて描き直す
export const store = {
  state: {
    connected: false, ready: false, bg: { available: false, error: '', loaded: false, list: [] }, settings: null, claudeDefaults: {},
    recentDirs: [], dataDir: '', claudePath: '', update: null,
    items: {}, open: null, sel: null, peek: null, palette: false, dialog: null, menu: null, toasts: [],
    collapsed: { recent: false }, showAllRecent: false,
    newDraft: null,
  },
  subs: new Set(),
  queued: false,
  set(patch) {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    if (!next) return;
    this.state = { ...this.state, ...next };
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      for (const f of this.subs) f();
    });
  },
};

export function useStore() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((t) => t + 1);
    store.subs.add(f);
    return () => store.subs.delete(f);
  }, []);
  return store.state;
}

export function mergeItems(list = [], incoming = []) {
  const out = list.slice();
  const index = new Map(out.map((it, i) => [it.id, i]));
  for (const it of incoming) {
    const i = index.get(it.id);
    if (i == null) {
      index.set(it.id, out.length);
      out.push(it);
    } else out[i] = it;
  }
  return out;
}

let toastSeq = 0;
export function toast(text, kind = 'info', ms = 3800) {
  const id = ++toastSeq;
  store.set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}
