// コマンドパレット（Ctrl+K）・設定・メニュー・通知
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Icon } from './icons.js';
import { api } from './api.js';
import { store, toast } from './store.js';
import { COMMANDS, RESERVED, bindingsOf, comboOf, comboParts, conflicts } from './keys.js';
import { checkUpdate } from './update.js';
import { EFFORTS, MODELS, MODES, STATUS_LABEL, ago, basename, bgStatus, effortLabel, modeLabel, modelLabel } from './util.js';

const html = htm.bind(h);

export function Menu() {
  const m = store.state.menu;
  const ref = useRef();
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!m || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let left = m.align === 'right' ? m.x - r.width : m.x;
    left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
    let top = m.y - r.height - 6;
    if (top < 8) top = m.bottom + 6;
    setPos({ left, top });
  }, [m]);
  if (!m) return null;
  return html`<div class="overlay" style="background:transparent;padding:0" onMouseDown=${() => store.set({ menu: null })}>
    <div class="menu" ref=${ref} style=${pos ? `left:${pos.left}px;top:${pos.top}px` : 'visibility:hidden'} onMouseDown=${(e) => e.stopPropagation()}>
      ${m.items.map((it) => (it === 'sep' ? html`<div class="menu-sep"></div>` : it.header ? html`<div class="menu-label">${it.header}</div>`
        : html`<button class="menu-item" disabled=${it.disabled} style=${it.disabled ? 'opacity:.45' : ''} onClick=${() => {
          store.set({ menu: null });
          it.onSelect?.();
        }}>
          <span>${it.checked ? html`<${Icon} n="check" s=${14} />` : it.icon ? html`<${Icon} n=${it.icon} s=${14} />` : ''}</span><span>${it.label}</span><span class="muted" style="font-size:11px">${it.hint || ''}</span>
          ${it.desc ? html`<small>${it.desc}</small>` : ''}
        </button>`))}
    </div>
  </div>`;
}

export function Toasts() {
  const t = store.state.toasts;
  return html`<div class="toasts">${t.map((x) => html`<div class=${`toast ${x.kind}`} key=${x.id}><${Icon} n=${x.kind === 'error' ? 'alert' : 'check'} s=${15} /><span>${x.text}</span></div>`)}</div>`;
}

// ---- パレット ----
export function Palette({ run, onOpen }) {
  const st = store.state;
  const [q, setQ] = useState('');
  const [act, setAct] = useState(0);
  const inp = useRef();
  useEffect(() => inp.current?.focus(), []);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (txt) => words.every((w) => txt.toLowerCase().includes(w));
  const actions = [
    { icon: 'plus', title: '新しい裏セッション', cmd: 'chat.new' },
    { icon: 'settings', title: '設定', cmd: 'settings.open' },
    { icon: 'keyboard', title: 'キー操作の設定', run: () => store.set({ dialog: { tab: 'keys' } }) },
    { icon: 'moon', title: 'ダーク・ライトの切り替え', cmd: 'theme.toggle' },
    { icon: 'sidebar', title: '一覧の表示・非表示', cmd: 'sidebar.toggle' },
  ].filter((a) => !q || hit(a.title));
  const list = [...st.bg.list].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
    .filter((a) => !q || hit(`${a.title} ${a.cwd} ${a.id} ${a.lastText} ${a.lastUser} ${a.firstPrompt}`)).slice(0, q ? 40 : 10);
  const groups = [
    actions.length && { label: '操作', items: actions.map((a) => ({ ...a, onPick: () => (a.cmd ? run(a.cmd) : a.run()) })) },
    list.length && { label: q ? '裏セッション' : '最近の裏セッション', items: list.map((a) => ({
      icon: 'layers', title: a.title, sub: `${basename(a.cwd)} · ${a.id} · ${ago(a.lastAt)}${STATUS_LABEL[bgStatus(a)] ? ` · ${STATUS_LABEL[bgStatus(a)]}` : ''}`,
      onPick: () => onOpen(`b:${a.id}`) })) },
  ].filter(Boolean);
  const flat = groups.flatMap((g) => g.items);
  const pick = (it) => {
    store.set({ palette: false });
    Promise.resolve(it.onPick()).catch((e) => toast(e.message, 'error'));
  };
  let n = -1;
  return html`<div class="overlay" onMouseDown=${() => store.set({ palette: false })}>
    <div class="palette" onMouseDown=${(e) => e.stopPropagation()}>
      <input ref=${inp} value=${q} placeholder="裏セッション（名前・フォルダ・ID・中身）と操作を探す" onInput=${(e) => {
        setQ(e.target.value);
        setAct(0);
      }} onKeyDown=${(e) => {
        if (e.isComposing) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setAct(Math.min(act + 1, flat.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setAct(Math.max(act - 1, 0)); }
        else if (e.key === 'Enter' && flat[act]) { e.preventDefault(); pick(flat[act]); }
      }} />
      <div class="results">
        ${groups.map((g) => html`<div class="p-label">${g.label}</div>${g.items.map((it) => {
          n += 1;
          const i = n;
          return html`<div class=${`p-item${i === act ? ' active' : ''}`} onMouseEnter=${() => setAct(i)} onClick=${() => pick(it)}>
            <${Icon} n=${it.icon} s=${15} /><span class="t">${it.title}</span><span></span>${it.sub ? html`<span class="s">${it.sub}</span>` : ''}</div>`;
        })}`)}
        ${!flat.length && html`<div class="p-label" style="font-weight:400">見つかりません</div>`}
      </div>
    </div>
  </div>`;
}

// ---- 設定 ----
function Switch({ on, onChange }) {
  return html`<button class=${`switch${on ? ' on' : ''}`} role="switch" aria-checked=${on} onClick=${() => onChange(!on)}></button>`;
}

async function saveSettings(patch) {
  try {
    const r = await api('/api/settings', patch);
    store.set({ settings: r.settings });
  } catch (e) {
    toast(e.message, 'error');
  }
}

function General() {
  const st = store.state;
  const s = st.settings;
  const d = st.claudeDefaults || {};
  const setDef = (k, v) => saveSettings({ defaults: { ...s.defaults, [k]: v } });
  return html`<div>
    <h2>一般</h2><p class="lead">新しい裏セッション（claude --bg）の既定と、知らせ方。</p>
    <div class="field"><div class="lbl">既定のフォルダ<small>新しい裏セッションで最初に選ばれる</small></div>
      <input class="input mono" style="font-size:12.5px" value=${s.defaults.cwd} onChange=${(e) => setDef('cwd', e.target.value.trim())} /></div>
    <div class="field"><div class="lbl">既定のモデル</div>
      <select class="select" value=${s.defaults.model} onChange=${(e) => setDef('model', e.target.value)}>
        <option value="">Claude Code の設定どおり（${modelLabel(MODELS, d.model) || d.model || '既定'}）</option>
        ${MODELS.map((m) => html`<option value=${m.value}>${m.label}</option>`)}</select></div>
    <div class="field"><div class="lbl">既定の権限</div>
      <select class="select" value=${s.defaults.mode} onChange=${(e) => setDef('mode', e.target.value)}>
        <option value="">Claude Code の設定どおり（${modeLabel(d.mode)}）</option>
        ${MODES.map((m) => html`<option value=${m.value}>${m.label}</option>`)}</select></div>
    <div class="field"><div class="lbl">既定の思考の深さ</div>
      <select class="select" value=${s.defaults.effort} onChange=${(e) => setDef('effort', e.target.value)}>
        <option value="">Claude Code の設定どおり（${effortLabel(d.effort) || '自動'}）</option>
        ${EFFORTS.map((m) => html`<option value=${m.value}>${m.label}</option>`)}</select></div>
    <div class="field"><div class="lbl">デスクトップ通知<small>裏セッションが入力待ち・完了・エラーになったとき（この画面を見ていないときだけ）</small></div>
      <${Switch} on=${s.notify} onChange=${async (v) => {
        if (v && 'Notification' in window && Notification.permission !== 'granted') {
          const p = await Notification.requestPermission();
          if (p !== 'granted') return toast('ブラウザの通知が許可されていません', 'error');
        }
        saveSettings({ notify: v });
      }} /></div>
  </div>`;
}

function Keys() {
  const st = store.state;
  const [rec, setRec] = useState(null);
  const [warn, setWarn] = useState('');
  const b = bindingsOf(st.settings);
  const conf = conflicts(b);
  useEffect(() => {
    if (!rec) return undefined;
    const onKey = (e) => {
      if (e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      const c = comboOf(e);
      if (!c) return;
      if (c === 'escape' && !e.shiftKey) {
        setRec(null);
        return;
      }
      if (RESERVED.has(c)) {
        setWarn(`${comboParts(c).join(' + ')} はブラウザが先に使うため、割り当てられません`);
        return;
      }
      setWarn('');
      setRec(null);
      saveSettings({ keybindings: { ...st.settings.keybindings, [rec]: c } });
    };
    window.addEventListener('keydown', onKey, true);
    store.set({ recording: true });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      store.set({ recording: false });
    };
  }, [rec]);
  const groups = [...new Set(COMMANDS.map((c) => c.group))];
  return html`<div>
    <h2>キー操作</h2>
    <p class="lead">ボタンを押してから、割り当てたいキーを押します。同時に効く操作とキーが重なると黄色で知らせます。</p>
    <div class="callout" style="margin-bottom:12px">送信は <b>Ctrl + Enter</b> が既定で、Enter は改行です（送信を Enter にしたときは Shift + Enter で改行）。</div>
    ${warn && html`<div class="banner" style="margin:0 0 10px">${warn}</div>`}
    ${groups.map((g) => html`<div class="menu-label" style="padding-left:0;margin-top:10px">${g}</div>
      ${COMMANDS.filter((c) => c.group === g).map((c) => html`<div class="kb-row">
        <div class="name">${c.label}${c.note ? html`<small>${c.note}</small>` : ''}</div>
        <button class=${`btn kb-key${rec === c.id ? ' recording' : ''}${conf[c.id] ? ' conflict' : ''}`} onClick=${() => setRec(rec === c.id ? null : c.id)}>
          ${rec === c.id ? 'キーを押す（Esc でやめる）' : b[c.id] ? html`<span class="kbd-group">${comboParts(b[c.id]).map((p) => html`<kbd>${p}</kbd>`)}</span>` : html`<span class="muted">未設定</span>`}
        </button>
        <span style="display:flex;gap:2px">
          <button class="icon-btn sm" title="既定に戻す" disabled=${(st.settings.keybindings[c.id] ?? null) === null} onClick=${() => {
            const k = { ...st.settings.keybindings };
            delete k[c.id];
            saveSettings({ keybindings: k });
          }}><${Icon} n="undo" s=${14} /></button>
          <button class="icon-btn sm" title="外す" onClick=${() => saveSettings({ keybindings: { ...st.settings.keybindings, [c.id]: '' } })}><${Icon} n="x" s=${14} /></button>
        </span>
        ${conf[c.id] && html`<div class="kb-warn">「${conf[c.id].join('」「')}」と同じキーです</div>`}
      </div>`)}`)}
    <div class="menu-label" style="padding-left:0;margin-top:14px">決まっているキー</div>
    <div class="callout">
      <div><kbd>1</kbd>〜<kbd>9</kbd> 質問の選択肢を選ぶ（入力欄が空か、入力欄の外にいるとき）</div>
      <div><kbd>Alt</kbd> + <kbd>1</kbd>〜<kbd>9</kbd> 一覧の n 番目を開く ・ 一覧の中では <kbd>↑</kbd><kbd>↓</kbd> で選ぶ ・ <kbd>Esc</kbd> で peek やメニューを閉じる</div>
    </div>
  </div>`;
}

function Look() {
  const s = store.state.settings;
  return html`<div>
    <h2>表示</h2>
    <div class="field"><div class="lbl">テーマ</div>
      <select class="select" value=${s.theme} onChange=${(e) => saveSettings({ theme: e.target.value })}>
        <option value="dark">ダーク</option><option value="light">ライト</option><option value="system">Windows に合わせる</option></select></div>
    <div class="field"><div class="lbl">文字の大きさ</div>
      <select class="select" value=${String(s.fontSize)} onChange=${(e) => saveSettings({ fontSize: Number(e.target.value) })}>
        ${[13, 14, 15, 16, 17].map((v) => html`<option value=${String(v)}>${v}px</option>`)}</select></div>
    <div class="field"><div class="lbl">会話の幅</div>
      <select class="select" value=${s.chatWidth} onChange=${(e) => saveSettings({ chatWidth: e.target.value })}>
        <option value="comfortable">標準</option><option value="wide">広い</option><option value="full">画面いっぱい</option></select></div>
  </div>`;
}

function About() {
  const st = store.state;
  const u = st.update;
  const busy = u?.status === 'updating';
  return html`<div>
    <h2>このアプリについて</h2>
    <p class="lead">claude --bg の裏セッション（ターミナルの agent view と同じもの）を、チャット画面で一覧・peek・返信するためのアプリです。</p>
    <div class="field"><div class="lbl">Claude Code<small>裏セッションを動かしている claude（ターミナルの claude と同じもの）</small></div>
      <div><div class="mono">${u?.current ?? '—'}</div><div class="mono muted" style="font-size:11px;word-break:break-all">${st.claudePath}</div></div></div>
    <div class="field"><div class="lbl">最新の版<small>${u?.checkedAt ? `${ago(u.checkedAt) === '今' ? 'さっき確認' : `${ago(u.checkedAt)}前に確認`}・3時間おきに確認します` : '3時間おきに確認します'}</small></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="mono">${u?.latest ?? '—'}</span>
        ${busy ? html`<span class="tag"><span class="spinner" style="width:10px;height:10px;margin-right:6px"></span>${u.step}</span>`
          : u?.available ? html`<button class="btn primary sm" onClick=${() => store.set({ updateDialog: true })}>更新する</button>`
            : html`<span class="tag">最新です</span>`}
        <button class="btn sm" disabled=${busy} onClick=${checkUpdate}><${Icon} n="refresh" s=${13} /> 今すぐ確認</button>
      </div></div>
    <div class="field"><div class="lbl">自動で更新する<small>新しい版が出たら claude update を実行します</small></div>
      <${Switch} on=${!!st.settings.autoUpdate} onChange=${(v) => saveSettings({ autoUpdate: v })} /></div>
    <div class="callout" style="margin:12px 0">
      一覧は <span class="mono">claude agents --json</span>、会話は Agent SDK の <span class="mono">getSessionMessages</span> で読んでいます。
      返信は <span class="mono">claude stop</span> のあと <span class="mono">claude --bg --resume ${'<ID>'}</span> で、同じ ID のまま続きます。
    </div>
    <div class="field"><div class="lbl">データの場所<small>未読・送る予定の返信・設定</small></div><div class="mono" style="font-size:12px;word-break:break-all">${st.dataDir}</div></div>
    <div class="field"><div class="lbl">サーバーを止める<small>裏セッションは止まりません（claude の daemon が動かしています）。次は start.cmd で起動</small></div>
      <div><button class="btn danger" onClick=${async () => {
        if (st.bg.list.some((a) => a.queue?.length) && !window.confirm('送る予定の返信があります。止めると、次に起動するまで送られません。止めますか？')) return;
        await api('/api/shutdown', {});
        toast('サーバーを止めました。ウィンドウを閉じてください');
      }}><${Icon} n="power" s=${14} /> 止める</button></div></div>
  </div>`;
}

export function SettingsDialog() {
  const d = store.state.dialog;
  const tabs = [['general', '一般', 'settings'], ['keys', 'キー操作', 'keyboard'], ['look', '表示', 'eye'], ['about', 'このアプリについて', 'help']];
  return html`<div class="overlay center" onMouseDown=${() => store.set({ dialog: null })}>
    <div class="dialog" onMouseDown=${(e) => e.stopPropagation()}>
      <nav><div class="h">設定</div>${tabs.map(([id, label, icon]) => html`<button class=${d.tab === id ? 'on' : ''} onClick=${() => store.set({ dialog: { tab: id } })}><${Icon} n=${icon} s=${15} />${label}</button>`)}</nav>
      <div class="pane">${d.tab === 'keys' ? html`<${Keys} />` : d.tab === 'look' ? html`<${Look} />` : d.tab === 'about' ? html`<${About} />` : html`<${General} />`}</div>
    </div>
  </div>`;
}
