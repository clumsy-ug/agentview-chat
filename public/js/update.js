// Claude Code の更新の案内
import { h } from 'preact';
import htm from 'htm';
import { Icon } from './icons.js';
import { api } from './api.js';
import { store, toast } from './store.js';

const html = htm.bind(h);
const CHANGELOG = 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md';
const shownFor = new Set();
let lastStatus = null;

// サーバーから更新の状態が届いたとき。新しい版が出ていれば案内を開き、終わったら知らせる
export function onUpdate(u) {
  const prev = lastStatus;
  lastStatus = u.status;
  const patch = { update: u };
  if (u.available && u.latest && !u.auto && u.status !== 'updating' && !u.dismissed.includes(u.latest) && !shownFor.has(u.latest)) {
    shownFor.add(u.latest);
    patch.updateDialog = true;
  }
  store.set(patch);
  if (prev !== u.status && !store.state.updateDialog) {
    if (u.status === 'done') toast(u.message, 'info', 7000);
    else if (u.status === 'failed') toast(u.message, 'error', 8000);
  }
}

export const startUpdate = () => api('/api/update/apply', {}).catch((e) => toast(e.message, 'error'));
export const checkUpdate = () => api('/api/update/check', {}).then((u) => {
  store.set({ update: u });
  if (!u.available) toast(u.message || `最新です（Claude Code ${u.current}）`);
  else store.set({ updateDialog: true });
}).catch((e) => toast(e.message, 'error'));

export function UpdatePill() {
  const u = store.state.update;
  if (!u) return null;
  if (u.status === 'updating') {
    return html`<button class="up-pill busy" title=${u.step} onClick=${() => store.set({ updateDialog: true })}><span class="spinner"></span>更新中</button>`;
  }
  if (u.available) {
    return html`<button class="up-pill" title="新しい Claude Code があります" onClick=${() => store.set({ updateDialog: true })}><${Icon} n="arrowUp" s=${12} sw=${2.2} />${u.latest}</button>`;
  }
  return null;
}

export function UpdateDialog() {
  const st = store.state;
  const u = st.update;
  if (!u) return null;
  const close = () => store.set({ updateDialog: false });
  const later = () => {
    if (u.latest) api('/api/update/dismiss', { version: u.latest }).catch(() => {});
    close();
  };
  const setAuto = (v) => api('/api/settings', { autoUpdate: v }).then((r) => store.set({ settings: r.settings })).catch((e) => toast(e.message, 'error'));
  let body;
  if (u.status === 'updating') {
    body = html`
      <div class="up-head"><${Icon} n="refresh" s=${18} /> Claude Code ${u.latest} に更新しています</div>
      <div class="up-steps"><div class="up-step run"><span class="spinner"></span><span>${u.step}</span></div></div>
      <p class="up-note">閉じても裏で続きます。動いている裏セッションは止まりません。</p>
      <div class="card-actions"><span class="grow"></span><button class="btn" onClick=${close}>閉じる</button></div>`;
  } else if (u.status === 'done' || u.status === 'failed') {
    const ok = u.status === 'done';
    body = html`
      <div class="up-head" style=${ok ? '' : 'color:var(--amber)'}><${Icon} n=${ok ? 'check' : 'alert'} s=${18} /> ${ok ? '更新しました' : '更新できませんでした'}</div>
      <p>${u.message}</p>
      <div class="card-actions"><span class="grow"></span><button class="btn primary" onClick=${close}>閉じる</button></div>`;
  } else if (u.available && u.latest) {
    body = html`
      <div class="up-head"><${Icon} n="sparkle" s=${18} /> Claude Code の新しい版があります</div>
      <div class="up-ver"><span class="mono">${u.current}</span><${Icon} n="chevR" s=${16} /><span class="mono new">${u.latest}</span></div>
      <p>更新すると、公式の <span class="mono">claude update</span> で入れ替えます。ターミナルの claude も同じものです。</p>
      <p class="up-note">動いている裏セッションは止まりません。返信して起こしたとき（と新しい裏セッション）から新しい版になります。</p>
      <label class="up-check"><input type="checkbox" checked=${!!st.settings?.autoUpdate} onChange=${(e) => setAuto(e.target.checked)} /> 次から自動で更新する</label>
      <div class="card-actions">
        <a class="btn ghost sm" href=${CHANGELOG} target="_blank" rel="noopener noreferrer"><${Icon} n="external" s=${13} /> 変更点</a>
        <span class="grow"></span>
        <button class="btn" onClick=${later}>あとで</button>
        <button class="btn primary" onClick=${() => startUpdate()}>更新する</button>
      </div>`;
  } else {
    body = html`
      <div class="up-head"><${Icon} n="check" s=${18} /> 最新です</div>
      <p>Claude Code ${u.current} を使っています。</p>
      <div class="card-actions"><span class="grow"></span><button class="btn primary" onClick=${close}>閉じる</button></div>`;
  }
  return html`<div class="overlay center" onMouseDown=${close}>
    <div class="card update-card" onMouseDown=${(e) => e.stopPropagation()}>${body}</div>
  </div>`;
}
