// 左の一覧（状態ごとにまとめる）と peek
import { h } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Icon } from './icons.js';
import { Markdown } from './md.js';
import { store, toast } from './store.js';
import { api } from './api.js';
import { comboText } from './keys.js';
import { BgPendingCard } from './chat.js';
import { Composer } from './composer.js';
import { STATUS_LABEL, ago, basename, bgStatus, needsTerminal, plainPreview, waitText } from './util.js';
import { UpdatePill } from './update.js';

const html = htm.bind(h);
export const keyOf = (a) => `b:${a.id}`;
export const bgByKey = (key) => store.state.bg.list.find((a) => keyOf(a) === key);

export function bgGroups(list) {
  const g = { needs: [], working: [], error: [], done: [], idle: [] };
  for (const a of [...list].sort((x, y) => (y.lastAt ?? 0) - (x.lastAt ?? 0))) {
    const v = bgStatus(a);
    g[v === 'sending' ? 'working' : v].push(a);
  }
  return g;
}

// 一覧に並んでいる順（キー操作の上下・Alt+数字で使う）
export function orderedKeys(st) {
  const g = bgGroups(st.bg.list);
  return [...g.needs, ...g.working, ...g.error, ...g.done, ...(st.collapsed.recent ? [] : st.showAllRecent ? g.idle : g.idle.slice(0, 15))].map(keyOf);
}

let hoverTimer;
let leaveTimer;
function hoverRow(key, el) {
  clearTimeout(leaveTimer);
  clearTimeout(hoverTimer);
  if (store.state.peek?.pinned) return;
  hoverTimer = setTimeout(() => {
    if (store.state.open === key) return;
    const r = el.getBoundingClientRect();
    store.set({ peek: { key, top: r.top, left: r.right } });
  }, 380);
}
function leaveRow() {
  clearTimeout(hoverTimer);
  leaveTimer = setTimeout(() => {
    if (!store.state.peek?.pinned) store.set({ peek: null });
  }, 260);
}
export function keepPeek() {
  clearTimeout(leaveTimer);
}

// 一覧の行の2行目（何をしているか・何を待っているか）
export function whatOf(a) {
  const v = bgStatus(a);
  if (v === 'needs') {
    if (a.question?.length) return a.question[0].question;
    if (needsTerminal(a)) return [waitText(a.waitingFor), a.needs].filter(Boolean).join('：');
    return plainPreview(a.lastText, 120) || waitText(a.waitingFor);
  }
  if (v === 'sending') return '返信を送っています';
  if (v === 'working') return `${a.activity || '作業中'}${a.queue?.length ? `（送る予定 ${a.queue.length} 件）` : ''}`;
  if (v === 'error') return a.lastError || 'エラーで止まりました';
  const last = plainPreview(a.lastText, 120) || plainPreview(a.lastUser, 120);
  return a.bgBusy ? `裏でコマンドが動いています · ${last}` : last;
}

function Row({ a, onOpen }) {
  const st = store.state;
  const k = keyOf(a);
  const v = bgStatus(a);
  const cls = `row${st.sel === k ? ' sel' : ''}${st.open === k ? ' open' : ''}${a.unread ? ' unread' : ''}`;
  return html`<div class=${cls} data-key=${k} onClick=${() => onOpen(k)} onMouseEnter=${(e) => hoverRow(k, e.currentTarget)} onMouseLeave=${leaveRow}>
    ${v === 'working' || v === 'sending' ? html`<span class="spinner" style="color:var(--blue);width:10px;height:10px"></span>` : html`<span class=${`dot ${v}`}></span>`}
    <span class="row-title">${a.title}</span>
    <span class="row-time">${ago(a.lastAt)}</span>
    <span class="row-sub"><span class="proj">${basename(a.cwd)}</span><span class=${`what ${v === 'needs' ? 'needs' : v === 'error' ? 'error' : ''}`}>${whatOf(a)}</span></span>
  </div>`;
}

function Group({ id, title, count, children, collapsible = true }) {
  const st = store.state;
  const collapsed = !!st.collapsed[id];
  return html`<div class=${`group${collapsed ? ' collapsed' : ''}`}>
    <div class="group-head" onClick=${() => collapsible && store.set({ collapsed: { ...st.collapsed, [id]: !collapsed } })}>
      ${collapsible && html`<${Icon} n="chevD" s=${12} cls="chev" />`}<span>${title}</span><span class="count">${count}</span>
    </div>
    <div class="rows">${children}</div>
  </div>`;
}

export function Sidebar({ onOpen, onNew, bindings }) {
  const st = store.state;
  const g = bgGroups(st.bg.list);
  const recent = st.showAllRecent ? g.idle : g.idle.slice(0, 15);
  const rows = (list) => list.map((a) => html`<${Row} key=${a.id} a=${a} onOpen=${onOpen} />`);
  return html`<aside class="sidebar">
    <div class="sb-head">
      <div class="brand"><img src="/icon.svg" alt="" /><span>Agent View</span><span class="brand-sub">claude --bg</span></div>
      <button class="icon-btn" title=${`一覧を隠す（${comboText(bindings['sidebar.toggle'])}）`} onClick=${() => store.set({ sidebarHidden: true })}><${Icon} n="sidebar" s=${16} /></button>
    </div>
    <button class="btn primary sb-new" onClick=${onNew}><${Icon} n="plus" s=${15} /> 新しい裏セッション <span style="opacity:.75;font-size:11px;margin-left:auto">${comboText(bindings['chat.new'])}</span></button>
    <button class="sb-search" onClick=${() => store.set({ palette: true })}><${Icon} n="search" s=${14} /><span>裏セッションを探す</span><kbd>${comboText(bindings['palette.toggle'])}</kbd></button>
    <div class="sb-list" tabindex="0" data-list="1">
      ${st.bg.error && html`<div class="note" style="margin:8px 12px">${st.bg.error}</div>`}
      ${g.needs.length > 0 && html`<${Group} id="g-needs" title="入力待ち" count=${g.needs.length}>${rows(g.needs)}</${Group}>`}
      ${g.working.length > 0 && html`<${Group} id="g-working" title="作業中" count=${g.working.length}>${rows(g.working)}</${Group}>`}
      ${g.error.length > 0 && html`<${Group} id="g-error" title="エラー" count=${g.error.length}>${rows(g.error)}</${Group}>`}
      ${g.done.length > 0 && html`<${Group} id="g-done" title="完了（未読）" count=${g.done.length}>${rows(g.done)}</${Group}>`}
      ${g.idle.length > 0 && html`<${Group} id="recent" title="最近" count=${g.idle.length}>
        ${rows(recent)}
        ${g.idle.length > 15 && html`<button class="sb-more" onClick=${() => store.set({ showAllRecent: !st.showAllRecent })}>${st.showAllRecent ? '少なく表示' : `ほか ${g.idle.length - 15} 件を表示`}</button>`}
      </${Group}>`}
      ${st.bg.loaded && !st.bg.list.length && !st.bg.error && html`<div class="sb-empty">裏セッションはまだありません。<br />「新しい裏セッション」か、ターミナルで <span class="mono">claude --bg</span> を使って始めると、ここに出ます。</div>`}
      ${!st.bg.loaded && !st.bg.error && html`<div class="sb-empty"><span class="spinner" style="width:10px;height:10px;margin-right:6px"></span>claude agents を読んでいます…</div>`}
    </div>
    <div class="sb-foot">
      <button class="icon-btn sm" title=${`設定（${comboText(bindings['settings.open'])}）`} onClick=${() => store.set({ dialog: { tab: 'general' } })}><${Icon} n="settings" s=${15} /></button>
      <span class="ver" title="裏セッションを動かしている claude（ターミナルの claude と同じもの）">Claude Code ${st.update?.current ?? '?'}</span>
      <${UpdatePill} />
      ${!st.connected && html`<span class="tag" style="color:var(--amber)">再接続中</span>`}
    </div>
  </aside>`;
}

// ---- peek ----
export function Peek({ onOpen, onReply, onStop, onTerminal, bindings }) {
  const st = store.state;
  const pk = st.peek;
  const ref = useRef();
  const [top, setTop] = useState(pk?.top ?? 0);
  const a = pk ? bgByKey(pk.key) : null;
  // peek は一覧の要約だけで出す（会話全体は開いたときに読む）
  useLayoutEffect(() => {
    if (!ref.current || !pk) return;
    const hgt = ref.current.offsetHeight;
    setTop(Math.max(10, Math.min(pk.top - 14, window.innerHeight - hgt - 10)));
  }, [pk?.key, pk?.top, a?.lastText, a?.group]);
  if (!pk || !a) return null;
  const v = bgStatus(a);
  const left = Math.min(pk.left + 10, window.innerWidth - 470);
  const pin = () => store.set({ peek: { ...pk, pinned: true } });
  return html`<div class="peek" ref=${ref} style=${`top:${top}px;left:${left}px`} onMouseEnter=${keepPeek}
    onMouseLeave=${() => !pk.pinned && leaveRow()} onMouseDown=${pin}>
    <div class="peek-head">
      ${v === 'working' || v === 'sending' ? html`<span class="spinner" style="color:var(--blue)"></span>` : html`<span class=${`dot ${v}`}></span>`}
      <span class="title ellipsis">${a.title}</span>
      ${STATUS_LABEL[v] && html`<span class=${`pill ${v}`}>${STATUS_LABEL[v]}</span>`}
      <button class="icon-btn sm" title="閉じる（Esc）" onClick=${() => store.set({ peek: null })}><${Icon} n="x" s=${14} /></button>
    </div>
    <div class="peek-meta">
      <span><${Icon} n="folder" s=${12} /> ${basename(a.cwd)}</span>
      <span class="mono">claude --bg · ${a.id}</span>
      ${v === 'working' && a.activity ? html`<span class="ellipsis">· ${a.activity}</span>` : ''}
      ${a.bgBusy ? html`<span>· 裏でコマンドが動いています</span>` : ''}
    </div>
    <div class="peek-body">
      <${BgPendingCard} a=${a} compact=${true} onReply=${(t) => onReply(a, t).catch((e) => toast(e.message, 'error'))} onTerminal=${() => onTerminal(a)} />
      ${a.queue?.length > 0 && html`<div class="peek-user">送る予定: <b>${plainPreview(a.queue.join(' / '), 160)}</b></div>`}
      ${a.lastUser && html`<div class="peek-user">あなた: <b>${plainPreview(a.lastUser, 160)}</b></div>`}
      ${a.lastText ? html`<div class="peek-last"><${Markdown} text=${a.lastText.length > 4000 ? `${a.lastText.slice(0, 4000)}…` : a.lastText} /></div>`
        : html`<div class="muted" style="font-size:12.5px">${v === 'working' || v === 'sending' ? '作業しています…' : 'まだ返事はありません'}</div>`}
      ${a.lastError && html`<div class="msg-note error">${a.lastError}</div>`}
    </div>
    <div class="peek-reply" onFocusIn=${pin}>
      <${Composer} id=${`peek-${a.id}`} minimal=${true} working=${v === 'working'} bindings=${bindings} stopTitle="止める"
        placeholder=${v === 'working' ? `終わったら送る（${comboText(bindings['composer.send'])}）` : `返信（${comboText(bindings['composer.send'])}）`}
        onSend=${(t, now) => onReply(a, t, now)} onInterrupt=${() => onStop(a)} />
    </div>
    <div class="peek-foot">
      <button class="btn sm primary" onClick=${() => onOpen(pk.key)}><${Icon} n="message" s=${13} /> 開く</button>
      <button class="btn sm" onClick=${() => onTerminal(a)}><${Icon} n="terminal" s=${13} /> ターミナルで開く</button>
      ${v === 'working' && html`<button class="btn sm" onClick=${() => onStop(a)}><${Icon} n="stop" s=${12} /> 止める</button>`}
    </div>
  </div>`;
}

// 会話を読む（同じものを続けて読みに行かない）
const loading = new Map();
export async function loadItems(a, force = false) {
  const key = keyOf(a);
  const last = loading.get(key) || 0;
  if (!force && Date.now() - last < 900) return;
  loading.set(key, Date.now());
  try {
    const r = await api(`/api/bg/${encodeURIComponent(a.id)}/items`);
    store.set((s) => ({ items: { ...s.items, [key]: r.items } }));
  } catch {
    store.set((s) => ({ items: { ...s.items, [key]: s.items[key] ?? [] } }));
  }
}
