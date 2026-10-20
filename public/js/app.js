import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { api, connect } from './api.js';
import { store, toast, useStore } from './store.js';
import { Peek, Sidebar, bgByKey, keyOf, loadItems, orderedKeys } from './sidebar.js';
import { BgPendingCard, Thread, cardKeys } from './chat.js';
import { Composer, FolderPicker, OptionButtons, openMenu } from './composer.js';
import { Menu, Palette, SettingsDialog, Toasts } from './dialogs.js';
import { UpdateDialog, onUpdate } from './update.js';
import { Icon } from './icons.js';
import { COMMANDS, bindingsOf, comboOf, comboParts, comboText } from './keys.js';
import { MODELS, STATUS_LABEL, basename, bgStatus, needsTerminal, plainPreview } from './util.js';

const html = htm.bind(h);
const openBg = () => (store.state.open?.startsWith('b:') ? bgByKey(store.state.open) : null);

function focusComposerSoon() {
  setTimeout(() => document.querySelector('.main [data-composer]')?.focus(), 30);
}

const act = {
  open(key) {
    store.set({ open: key, peek: null, sel: key });
    localStorage.setItem('avc.open', key);
    const a = bgByKey(key);
    if (a) {
      loadItems(a, true);
      if (a.unread) api(`/api/bg/${encodeURIComponent(a.id)}/read`, {}).catch(() => {});
      focusComposerSoon();
    }
  },
  newSession() {
    const d = store.state.settings.defaults;
    store.set({ open: 'new', peek: null, newDraft: { cwd: d.cwd, model: d.model, mode: d.mode, effort: d.effort } });
    focusComposerSoon();
  },
  async dispatch(text) {
    const d = store.state.newDraft;
    const r = await api('/api/bg', { cwd: d.cwd, text, model: d.model, mode: d.mode, effort: d.effort });
    toast(`裏セッション ${r.id} を始めました（claude --bg）`);
    act.open(`b:${r.id}`);
  },
  // 作業中なら、今の作業が終わってから送る（now なら止めて今すぐ）
  async reply(a, text, now = false) {
    const r = await api(`/api/bg/${encodeURIComponent(a.id)}/reply`, { text, now });
    if (r.queued) toast('今の作業が終わったら送ります');
  },
  async stop(a) {
    try {
      await api(`/api/bg/${encodeURIComponent(a.id)}/stop`, {});
      toast('止めました（会話は残っています。返信すると続きから動きます）');
    } catch (e) {
      toast(e.message, 'error');
    }
  },
  remove(a) {
    store.set({ confirm: { text: `「${a.title}」を一覧から消しますか？（claude rm。worktree も消えます）`, ok: '消す', run: async () => {
      try {
        await api(`/api/bg/${encodeURIComponent(a.id)}/remove`, {});
        if (store.state.open === keyOf(a)) store.set({ open: null });
        toast('消しました');
      } catch (e) {
        toast(e.message, 'error');
      }
    } } });
  },
  async terminal(a) {
    try {
      await api(`/api/bg/${encodeURIComponent(a.id)}/terminal`, {});
      toast(`ターミナルで開きました（claude attach ${a.id}）`);
    } catch (e) {
      toast(e.message, 'error');
    }
  },
  cancelQueue(a) {
    api(`/api/bg/${encodeURIComponent(a.id)}/cancel-queue`, {}).catch((e) => toast(e.message, 'error'));
  },
  openFolder(dir) {
    api('/api/open-folder', { dir }).catch((e) => toast(e.message, 'error'));
  },
};
const replyOrToast = (a, t, now) => act.reply(a, t, now).catch((e) => toast(e.message, 'error'));

async function saveSettings(patch) {
  const r = await api('/api/settings', patch);
  store.set({ settings: r.settings });
}

function applySettings(s) {
  if (!s) return;
  const dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.setProperty('--fs', `${s.fontSize}px`);
  root.style.setProperty('--chat-w', s.chatWidth === 'wide' ? '1060px' : s.chatWidth === 'full' ? '100%' : '780px');
}

function notifyDesktop(n) {
  const st = store.state;
  if (!st.settings?.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  const head = n.kind === 'needs' ? '入力待ち' : n.kind === 'error' ? 'エラー' : '完了';
  const note = new Notification(`${head}: ${n.title}`, { body: plainPreview(n.text, 140), tag: `avc-${n.id}`, icon: '/icon.svg' });
  note.onclick = () => {
    window.focus();
    act.open(`b:${n.id}`);
    note.close();
  };
}

// ---- キー操作 ----
function moveSel(d) {
  const st = store.state;
  const keys = orderedKeys(st);
  if (!keys.length) return;
  const i = keys.indexOf(st.sel ?? st.open);
  const k = keys[Math.max(0, Math.min(keys.length - 1, i < 0 ? 0 : i + d))];
  const row = document.querySelector(`[data-key="${k}"]`);
  row?.scrollIntoView({ block: 'nearest' });
  const patch = { sel: k };
  if (st.peek && row) {
    const r = row.getBoundingClientRect();
    patch.peek = { key: k, top: r.top, left: r.right, pinned: true };
  }
  store.set(patch);
}

function run(id) {
  const st = store.state;
  const a = openBg();
  switch (id) {
    case 'chat.new':
      return act.newSession();
    case 'palette.toggle':
      return store.set({ palette: !st.palette });
    case 'sidebar.toggle':
      return store.set({ sidebarHidden: !st.sidebarHidden });
    case 'settings.open':
      return store.set({ dialog: { tab: 'general' } });
    case 'theme.toggle':
      return saveSettings({ theme: document.documentElement.classList.contains('dark') ? 'light' : 'dark' });
    case 'session.prev':
    case 'session.next': {
      const keys = orderedKeys(st);
      if (!keys.length) return undefined;
      const i = keys.indexOf(st.open);
      const j = i < 0 ? 0 : (i + (id === 'session.next' ? 1 : -1) + keys.length) % keys.length;
      return act.open(keys[j]);
    }
    case 'session.nextNeeds': {
      const keys = orderedKeys(st).filter((k) => bgByKey(k)?.group === 'needs');
      if (!keys.length) return toast('入力待ちの裏セッションはありません');
      const i = keys.indexOf(st.open);
      return act.open(keys[(i + 1) % keys.length]);
    }
    case 'focus.list': {
      document.querySelector('[data-list]')?.focus();
      if (!st.sel) store.set({ sel: orderedKeys(st)[0] ?? null });
      return undefined;
    }
    case 'focus.composer':
      return document.querySelector('.main [data-composer]')?.focus();
    case 'peek.toggle': {
      if (st.peek) return store.set({ peek: null });
      const row = st.sel && document.querySelector(`[data-key="${st.sel}"]`);
      if (!row) return undefined;
      const r = row.getBoundingClientRect();
      return store.set({ peek: { key: st.sel, top: r.top, left: r.right, pinned: true } });
    }
    case 'session.open':
      return st.sel && act.open(st.sel);
    case 'session.interrupt':
      return a && a.group === 'working' && act.stop(a);
    case 'session.terminal':
      return a && act.terminal(a);
    default:
      return undefined;
  }
}

function onKey(e) {
  const st = store.state;
  if (st.recording || !st.ready || e.isComposing || e.keyCode === 229) return;
  const combo = comboOf(e);
  if (!combo) return;
  const ae = document.activeElement;
  const inComposer = !!ae?.dataset?.composer;
  const inInput = !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable);
  const inList = !!ae?.closest?.('[data-list]');
  if (combo === 'escape') {
    const close = st.menu ? { menu: null } : st.confirm ? { confirm: null } : st.updateDialog ? { updateDialog: false } : st.palette ? { palette: false } : st.dialog ? { dialog: null } : st.peek ? { peek: null } : null;
    if (close) {
      e.preventDefault();
      store.set(close);
      return;
    }
  }
  if (st.palette || st.dialog || st.menu || st.confirm || st.updateDialog) return;
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
  if (!st.peek && plain && (!inInput || (inComposer && !ae.value)) && /^[1-9]$/.test(e.key) && cardKeys(e.key)) {
    e.preventDefault();
    return;
  }
  const jump = /^alt\+([1-9])$/.exec(combo);
  if (jump) {
    const k = orderedKeys(st)[Number(jump[1]) - 1];
    if (k) {
      e.preventDefault();
      act.open(k);
    }
    return;
  }
  if (inList && (combo === 'arrowdown' || combo === 'arrowup')) {
    e.preventDefault();
    moveSel(combo === 'arrowdown' ? 1 : -1);
    return;
  }
  const b = bindingsOf(st.settings);
  for (const c of COMMANDS) {
    if (!b[c.id] || b[c.id] !== combo || c.id.startsWith('composer.')) continue;
    if (c.when === 'list' && !inList) continue;
    if (c.when === 'noinput' && inInput) continue;
    if (c.when === 'session' && !(openBg()?.group === 'working' && (inComposer || !inInput))) continue;
    e.preventDefault();
    run(c.id);
    return;
  }
}

// ---- 画面 ----
function SidebarToggle() {
  return store.state.sidebarHidden ? html`<button class="icon-btn" title="一覧を出す" onClick=${() => store.set({ sidebarHidden: false })}><${Icon} n="sidebar" /></button>` : null;
}

function BgHeader({ a }) {
  const v = bgStatus(a);
  return html`<div class="header">
    <${SidebarToggle} />
    <span class="title" title=${a.title}>${a.title}</span>
    ${STATUS_LABEL[v] && html`<span class=${`pill ${v}`}>${v === 'working' || v === 'sending' ? html`<span class="spinner"></span>` : ''}${STATUS_LABEL[v]}</span>`}
    <button class="chip" title=${`${a.cwd}（クリックでフォルダを開く）`} onClick=${() => act.openFolder(a.cwd)}><${Icon} n="folder" s=${13} /><span>${basename(a.cwd)}</span></button>
    <span class="tag mono" title="ターミナルの agent view（claude agents）と同じ裏セッション">claude --bg · ${a.id}</span>
    ${a.bgBusy && html`<span class="tag" title="回答は終わっていて、run_in_background などのコマンドだけが動いています">裏でコマンド実行中</span>`}
    <span class="grow"></span>
    <button class="btn ghost sm" title=${`claude attach ${a.id}`} onClick=${() => act.terminal(a)}><${Icon} n="terminal" s=${14} /> ターミナルで開く</button>
    <button class="icon-btn" title="その他" onClick=${(e) => openMenu(e, [
      { label: '止める（claude stop）', icon: 'stop', desc: '会話は残ります。返信すると続きから動きます', disabled: a.group !== 'working' && a.group !== 'needs', onSelect: () => act.stop(a) },
      { label: 'フォルダを開く', icon: 'folder', onSelect: () => act.openFolder(a.cwd) },
      { label: 'ID をコピー', icon: 'copy', onSelect: () => navigator.clipboard.writeText(a.id).then(() => toast('コピーしました')) },
      'sep',
      { label: '一覧から消す（claude rm）', icon: 'archive', onSelect: () => act.remove(a) },
    ], 'right')}><${Icon} n="more" /></button>
  </div>`;
}

function QueueCard({ a }) {
  if (!a.queue?.length) return null;
  return html`<div class="cards"><div class="card">
    <div class="card-head" style="color:var(--muted)"><${Icon} n="clock" s=${14} /> 今の作業が終わったら送ります</div>
    ${a.queue.map((t) => html`<div class="queue-item">${t}</div>`)}
    <div class="card-actions"><span class="grow"></span><button class="btn sm" onClick=${() => act.cancelQueue(a)}>取り消す</button></div>
  </div></div>`;
}

function BgView({ a }) {
  const st = store.state;
  const b = bindingsOf(st.settings);
  const key = keyOf(a);
  const v = bgStatus(a);
  // 開いているあいだは未読にしない。作業中は会話を読み直し続ける
  useEffect(() => {
    api(`/api/bg/${encodeURIComponent(a.id)}/watch`, { on: true }).catch(() => {});
    return () => api(`/api/bg/${encodeURIComponent(a.id)}/watch`, { on: false }).catch(() => {});
  }, [a.id]);
  useEffect(() => {
    loadItems(a);
    if (a.group !== 'working' && a.group !== 'sending') return undefined;
    const t = setInterval(() => {
      const cur = bgByKey(key);
      if (cur) loadItems(cur);
    }, 1500);
    return () => clearInterval(t);
  }, [a.id, a.group, a.changedAt, a.lastText]);
  useEffect(() => {
    if (a.unread && document.visibilityState === 'visible') api(`/api/bg/${encodeURIComponent(a.id)}/read`, {}).catch(() => {});
  }, [a.id, a.unread]);
  const s = { id: a.id, status: v === 'sending' ? 'working' : v === 'needs' || v === 'working' ? v : 'idle',
    activity: v === 'sending' ? '返信を送っています（裏セッションを止めて、同じ ID で起こしています）' : a.activity, workStartedAt: v === 'working' ? (a.turnAt ?? a.changedAt) : null };
  return html`<div class="main">
    <${BgHeader} a=${a} />
    <${Thread} s=${s} items=${st.items[key]} cwd=${a.cwd}
      hint=${html`<span class="kbd-group">${comboParts(b['session.interrupt']).map((p) => html`<kbd>${p}</kbd>`)}</span> で止める`} />
    <div class="composer-wrap">
      <${Composer} id=${a.id} working=${v === 'working'} bindings=${b} autoFocus=${true} stopTitle="止める（claude stop）"
        placeholder=${v === 'working' ? '追加の指示（今の作業が終わったら送ります）' : v === 'needs' && a.question?.length ? '上の質問に答えるか、ここに書いて返す' : needsTerminal(a) ? 'ここに書いて送ると、止めてから指示として続けます' : v === 'sending' ? '送っています…' : '返信する（止まっている裏セッションを、同じ ID のまま起こして続けます）'}
        cards=${html`${a.lastError && html`<div class="msg-note error" style="margin-bottom:8px">${a.lastError}</div>`}<${QueueCard} a=${a} />
          ${a.bgBusy && v !== 'working' && v !== 'sending' && html`<div class="msg-note" style="margin-bottom:8px">裏でコマンドが動いています（回答は終わっています）。返信してもコマンドは止まらず、Claude はそのまま終わるのを待ちます。</div>`}
          <${BgPendingCard} a=${a} onReply=${(t) => replyOrToast(a, t)} onTerminal=${() => act.terminal(a)} />`}
        hint=${v === 'working' ? '' : '返信は claude --bg --resume で送ります（同じ裏セッションのまま）'}
        onSend=${(t, now) => act.reply(a, t, now)} onInterrupt=${() => act.stop(a)} />
    </div>
  </div>`;
}

function NewSessionView() {
  const st = store.state;
  const d = st.newDraft;
  const b = bindingsOf(st.settings);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!picking) return undefined;
    const close = () => setPicking(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [picking]);
  const set = (p) => store.set({ newDraft: { ...store.state.newDraft, ...p } });
  return html`<div class="main">
    <div class="header"><${SidebarToggle} /><span class="title">新しい裏セッション</span></div>
    <div class="new-hero">
      <h1>裏で何を頼みますか？</h1>
      <p>フォルダを選んで書くと、<span class="mono">claude --bg</span> で裏で動きます。このアプリやターミナルを閉じても止まらず、ターミナルの agent view（<span class="mono">claude agents</span>）にも出ます。</p>
      <div class="composer-wrap">
        <${Composer} id="new" working=${false} bindings=${b} autoFocus=${true} placeholder=${`Claude に頼むこと（${comboText(b['composer.send'])} で裏で開始）`}
          bar=${html`<span style="position:relative;display:inline-flex">
              <button class=${`cbtn${picking ? ' on' : ''}`} title=${d.cwd} onMouseDown=${(e) => e.stopPropagation()} onClick=${() => setPicking(!picking)}>
                <${Icon} n="folder" s=${14} /><span>${basename(d.cwd) || 'フォルダを選ぶ'}</span><${Icon} n="chevD" s=${12} /></button>
              ${picking && html`<${FolderPicker} value=${d.cwd} onPick=${(cwd) => set({ cwd })} onClose=${() => setPicking(false)} />`}
            </span>
            <${OptionButtons} opts=${d} set=${set} models=${MODELS} defaults=${st.claudeDefaults} />`}
          onSend=${(t) => act.dispatch(t)} />
      </div>
      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;padding:6px 28px 0">
        ${st.recentDirs.slice(0, 6).map((dir) => html`<button class=${`chip${dir === d.cwd ? ' on' : ''}`} style=${dir === d.cwd ? 'color:var(--fg);border-color:var(--input)' : ''} title=${dir} onClick=${() => set({ cwd: dir })}>
          <${Icon} n="folder" s=${12} /><span>${basename(dir)}</span></button>`)}
      </div>
    </div>
  </div>`;
}

function EmptyView() {
  const b = bindingsOf(store.state.settings);
  const keys = (id) => html`<span class="kbd-group">${comboParts(b[id]).map((p) => html`<kbd>${p}</kbd>`)}</span>`;
  return html`<div class="main"><div class="header"><${SidebarToggle} /></div><div class="empty"><div class="empty-inner">
    <div class="empty-title">claude --bg の裏セッションを、チャット画面で</div>
    <div class="empty-sub">ターミナルの agent view（claude agents）と同じ裏セッションです。左の一覧にマウスを乗せると中身をのぞけて（peek）、クリックで開いてそのまま返信できます。</div>
    <div class="shortcuts">
      <div>${keys('chat.new')}</div><div>新しい裏セッション</div>
      <div>${keys('palette.toggle')}</div><div>裏セッションを探す</div>
      <div>${keys('composer.send')}</div><div>送信</div>
      <div>${keys('session.nextNeeds')}</div><div>入力待ちの裏セッションへ</div>
      <div><span class="kbd-group"><kbd>Alt</kbd><kbd>↑</kbd><kbd>↓</kbd></span></div><div>前後の裏セッション</div>
      <div>${keys('settings.open')}</div><div>設定（キー操作も変えられます）</div>
    </div>
  </div></div></div>`;
}

function Confirm() {
  const c = store.state.confirm;
  return html`<div class="overlay center" onMouseDown=${() => store.set({ confirm: null })}>
    <div class="card" style="width:min(440px,90vw);padding:18px" onMouseDown=${(e) => e.stopPropagation()}>
      <div style="margin-bottom:14px">${c.text}</div>
      <div class="card-actions" style="justify-content:flex-end">
        <button class="btn" onClick=${() => store.set({ confirm: null })}>やめる</button>
        <button class="btn primary" onClick=${() => {
          store.set({ confirm: null });
          c.run();
        }}>${c.ok || 'OK'}</button>
      </div>
    </div>
  </div>`;
}

function App() {
  const st = useStore();
  useEffect(() => {
    window.addEventListener('keydown', onKey, true);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applySettings(store.state.settings));
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const needs = st.bg.list.filter((a) => a.group === 'needs').length;
  useEffect(() => {
    document.title = needs ? `(${needs}) Agent View` : 'Agent View';
  }, [needs]);
  if (!st.ready) return html`<div class="empty" style="height:100vh"><div class="working-line"><span class="spinner"></span> 接続しています…</div></div>`;
  const b = bindingsOf(st.settings);
  const a = openBg();
  let main;
  if (st.open === 'new' && st.newDraft) main = html`<${NewSessionView} />`;
  else if (a) main = html`<${BgView} a=${a} />`;
  else main = html`<${EmptyView} />`;
  return html`<div class=${`shell${st.sidebarHidden ? ' no-sidebar' : ''}`}>
    <${Sidebar} onOpen=${act.open} onNew=${act.newSession} bindings=${b} />
    ${main}
    <${Peek} onOpen=${act.open} onReply=${act.reply} onStop=${act.stop} onTerminal=${act.terminal} bindings=${b} />
    ${st.palette && html`<${Palette} run=${run} onOpen=${act.open} />`}
    ${st.dialog && html`<${SettingsDialog} />`}
    ${st.confirm && html`<${Confirm} />`}
    ${st.updateDialog && html`<${UpdateDialog} />`}
    <${Menu} />
    <${Toasts} />
  </div>`;
}

// ---- サーバーとつなぐ ----
let first = true;
connect({
  hello(d) {
    store.set({ ready: true, bg: d.bg, settings: d.settings, claudeDefaults: d.claudeDefaults, recentDirs: d.recentDirs, dataDir: d.dataDir, claudePath: d.claudePath });
    applySettings(d.settings);
    if (d.update) onUpdate(d.update);
    if (first) {
      first = false;
      const last = localStorage.getItem('avc.open');
      if (last?.startsWith('b:')) store.set({ open: last, sel: last });
    }
  },
  bg(b) {
    store.set({ bg: b });
  },
  settings(s) {
    store.set({ settings: s });
    applySettings(s);
  },
  notify: notifyDesktop,
  update: onUpdate,
}, (ok) => store.set({ connected: ok }));

render(html`<${App} />`, document.getElementById('app'));
