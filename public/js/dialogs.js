// コマンドパレット（Ctrl+K）・設定・メニュー・通知
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Icon } from './icons.js';
import { api } from './api.js';
import { store, toast } from './store.js';
import { COMMANDS, RESERVED, bindingsOf, comboOf, comboParts, conflicts } from './keys.js';
import { checkUpdate } from './update.js';
import { EFFORTS, MODELS, MODES, ago, basename, bgStatus, effortLabel, modeLabel, modelLabel, statusLabel } from './util.js';
import { t, tt } from './i18n.js';

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
    { icon: 'plus', title: t('新しい裏セッション'), cmd: 'chat.new' },
    { icon: 'settings', title: t('設定'), cmd: 'settings.open' },
    { icon: 'keyboard', title: t('キー操作の設定'), run: () => store.set({ dialog: { tab: 'keys' } }) },
    { icon: 'moon', title: t('ダーク・ライトの切り替え'), cmd: 'theme.toggle' },
    { icon: 'sidebar', title: t('一覧の表示・非表示'), cmd: 'sidebar.toggle' },
  ].filter((a) => !q || hit(a.title));
  const list = [...st.bg.list].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
    .filter((a) => !q || hit(`${a.title} ${a.cwd} ${a.id} ${a.lastText} ${a.lastUser} ${a.firstPrompt}`)).slice(0, q ? 40 : 10);
  const groups = [
    actions.length && { label: t('操作'), items: actions.map((a) => ({ ...a, onPick: () => (a.cmd ? run(a.cmd) : a.run()) })) },
    list.length && { label: q ? t('裏セッション') : t('最近の裏セッション'), items: list.map((a) => ({
      icon: 'layers', title: a.title, sub: `${basename(a.cwd)} · ${a.id} · ${ago(a.lastAt)}${statusLabel(bgStatus(a)) ? ` · ${statusLabel(bgStatus(a))}` : ''}`,
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
      <input ref=${inp} value=${q} placeholder=${tt('裏セッション（名前・フォルダ・ID・中身）と操作を探す', 'Search background sessions (name, folder, ID, content) and actions')} onInput=${(e) => {
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
        ${!flat.length && html`<div class="p-label" style="font-weight:400">${t('見つかりません')}</div>`}
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
    <h2>${t('一般')}</h2><p class="lead">${tt('新しい裏セッション（claude --bg）の既定と、知らせ方。', 'Defaults for new background sessions (claude --bg), and how you are notified.')}</p>
    <div class="field"><div class="lbl">${t('既定のフォルダ')}<small>${t('新しい裏セッションで最初に選ばれる')}</small></div>
      <input class="input mono" style="font-size:12.5px" value=${s.defaults.cwd} onChange=${(e) => setDef('cwd', e.target.value.trim())} /></div>
    <div class="field"><div class="lbl">${t('既定のモデル（設定）')}</div>
      <select class="select" value=${s.defaults.model} onChange=${(e) => setDef('model', e.target.value)}>
        <option value="">${tt(`Claude Code の設定どおり（${modelLabel(MODELS, d.model) || d.model || '既定'}）`, `Use Claude Code's setting (${modelLabel(MODELS, d.model) || d.model || 'default'})`)}</option>
        ${MODELS.map((m) => html`<option value=${m.value}>${m.label}</option>`)}</select></div>
    <div class="field"><div class="lbl">${t('既定の権限')}</div>
      <select class="select" value=${s.defaults.mode} onChange=${(e) => setDef('mode', e.target.value)}>
        <option value="">${tt(`Claude Code の設定どおり（${modeLabel(d.mode)}）`, `Use Claude Code's setting (${modeLabel(d.mode)})`)}</option>
        ${MODES.map((m) => html`<option value=${m.value}>${t(m.label)}</option>`)}</select></div>
    <div class="field"><div class="lbl">${t('既定の思考の深さ')}</div>
      <select class="select" value=${s.defaults.effort} onChange=${(e) => setDef('effort', e.target.value)}>
        <option value="">${tt(`Claude Code の設定どおり（${effortLabel(d.effort) || t('自動')}）`, `Use Claude Code's setting (${effortLabel(d.effort) || t('自動')})`)}</option>
        ${EFFORTS.map((m) => html`<option value=${m.value}>${t(m.label)}</option>`)}</select></div>
    <div class="field"><div class="lbl">${t('デスクトップ通知')}<small>${tt('裏セッションが入力待ち・完了・エラーになったとき（この画面を見ていないときだけ）', 'When a background session waits for input, finishes, or errors (only while you are not looking at this window)')}</small></div>
      <${Switch} on=${s.notify} onChange=${async (v) => {
        if (v && 'Notification' in window && Notification.permission !== 'granted') {
          const p = await Notification.requestPermission();
          if (p !== 'granted') return toast(t('ブラウザの通知が許可されていません'), 'error');
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
        setWarn(tt(`${comboParts(c).join(' + ')} はブラウザが先に使うため、割り当てられません`, `${comboParts(c).join(' + ')} is used by the browser first and cannot be assigned`));
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
    <h2>${t('キー操作')}</h2>
    <p class="lead">${tt('ボタンを押してから、割り当てたいキーを押します。同時に効く操作とキーが重なると黄色で知らせます。', 'Press a button, then press the key you want to assign. If two commands that can fire at the same time share a key, it is flagged in yellow.')}</p>
    <div class="callout" style="margin-bottom:12px">${tt('送信は ', 'Sending is ')}<b>Ctrl + Enter</b>${tt(' が既定で、Enter は改行です（送信を Enter にしたときは Shift + Enter で改行）。', ' by default, and Enter inserts a newline (if you assign sending to Enter, Shift + Enter inserts a newline).')}</div>
    ${warn && html`<div class="banner" style="margin:0 0 10px">${warn}</div>`}
    ${groups.map((g) => html`<div class="menu-label" style="padding-left:0;margin-top:10px">${t(g)}</div>
      ${COMMANDS.filter((c) => c.group === g).map((c) => html`<div class="kb-row">
        <div class="name">${t(c.label)}${c.note ? html`<small>${t(c.note)}</small>` : ''}</div>
        <button class=${`btn kb-key${rec === c.id ? ' recording' : ''}${conf[c.id] ? ' conflict' : ''}`} onClick=${() => setRec(rec === c.id ? null : c.id)}>
          ${rec === c.id ? t('キーを押す（Esc でやめる）') : b[c.id] ? html`<span class="kbd-group">${comboParts(b[c.id]).map((p) => html`<kbd>${p}</kbd>`)}</span>` : html`<span class="muted">${t('未設定')}</span>`}
        </button>
        <span style="display:flex;gap:2px">
          <button class="icon-btn sm" title=${t('既定に戻す')} disabled=${(st.settings.keybindings[c.id] ?? null) === null} onClick=${() => {
            const k = { ...st.settings.keybindings };
            delete k[c.id];
            saveSettings({ keybindings: k });
          }}><${Icon} n="undo" s=${14} /></button>
          <button class="icon-btn sm" title=${t('外す')} onClick=${() => saveSettings({ keybindings: { ...st.settings.keybindings, [c.id]: '' } })}><${Icon} n="x" s=${14} /></button>
        </span>
        ${conf[c.id] && html`<div class="kb-warn">${tt(`「${conf[c.id].map((x) => t(x)).join('」「')}」と同じキーです`, `Same key as ${conf[c.id].map((x) => t(x)).join(', ')}`)}</div>`}
      </div>`)}`)}
    <div class="menu-label" style="padding-left:0;margin-top:14px">${t('決まっているキー')}</div>
    <div class="callout">
      <div><kbd>1</kbd>〜<kbd>9</kbd>${tt(' 質問の選択肢を選ぶ（入力欄が空か、入力欄の外にいるとき）', ' choose an answer option (when the composer is empty, or focus is outside it)')}</div>
      <div><kbd>Alt</kbd> + <kbd>1</kbd>〜<kbd>9</kbd>${tt(' 一覧の n 番目を開く ・ 一覧の中では ', ' open the n-th item in the list · in the list, ')}<kbd>↑</kbd><kbd>↓</kbd>${tt(' で選ぶ ・ ', ' select · ')}<kbd>Esc</kbd>${tt(' で peek やメニューを閉じる', ' closes peek and menus')}</div>
    </div>
  </div>`;
}

function Look() {
  const s = store.state.settings;
  return html`<div>
    <h2>${t('表示')}</h2>
    <div class="field"><div class="lbl">${t('表示言語')}<small>${t('自動のときはブラウザの言語に合わせます')}</small></div>
      <select class="select" value=${s.lang || ''} onChange=${(e) => saveSettings({ lang: e.target.value })}>
        <option value="">${t('自動（ブラウザの言語）')}</option><option value="ja">日本語</option><option value="en">English</option></select></div>
    <div class="field"><div class="lbl">${t('テーマ')}</div>
      <select class="select" value=${s.theme} onChange=${(e) => saveSettings({ theme: e.target.value })}>
        <option value="dark">${t('ダーク')}</option><option value="light">${t('ライト')}</option><option value="system">${t('Windows に合わせる')}</option></select></div>
    <div class="field"><div class="lbl">${t('文字の大きさ')}</div>
      <select class="select" value=${String(s.fontSize)} onChange=${(e) => saveSettings({ fontSize: Number(e.target.value) })}>
        ${[13, 14, 15, 16, 17].map((v) => html`<option value=${String(v)}>${v}px</option>`)}</select></div>
    <div class="field"><div class="lbl">${t('会話の幅')}</div>
      <select class="select" value=${s.chatWidth} onChange=${(e) => saveSettings({ chatWidth: e.target.value })}>
        <option value="comfortable">${t('標準')}</option><option value="wide">${t('広い')}</option><option value="full">${t('画面いっぱい')}</option></select></div>
  </div>`;
}

function About() {
  const st = store.state;
  const u = st.update;
  const busy = u?.status === 'updating';
  return html`<div>
    <h2>${t('このアプリについて')}</h2>
    <p class="lead">${tt('claude --bg の裏セッション（ターミナルの agent view と同じもの）を、チャット画面で一覧・peek・返信するためのアプリです。', 'An app for listing, peeking at, and replying to claude --bg background sessions (the same ones as the terminal agent view) in a chat window.')}</p>
    <div class="field"><div class="lbl">Claude Code<small>${tt('裏セッションを動かしている claude（ターミナルの claude と同じもの）', 'The claude running the background sessions (the same one as in the terminal)')}</small></div>
      <div><div class="mono">${u?.current ?? '—'}</div><div class="mono muted" style="font-size:11px;word-break:break-all">${st.claudePath}</div></div></div>
    <div class="field"><div class="lbl">${t('最新の版')}<small>${u?.checkedAt ? tt(`${ago(u.checkedAt) === '今' || ago(u.checkedAt) === 'now' ? 'さっき確認' : `${ago(u.checkedAt)}前に確認`}・3時間おきに確認します`, `${ago(u.checkedAt) === 'now' ? 'Checked just now' : `Checked ${ago(u.checkedAt)} ago`}, and every 3 hours`) : tt('3時間おきに確認します', 'Checked every 3 hours')}</small></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="mono">${u?.latest ?? '—'}</span>
        ${busy ? html`<span class="tag"><span class="spinner" style="width:10px;height:10px;margin-right:6px"></span>${u.step}</span>`
          : u?.available ? html`<button class="btn primary sm" onClick=${() => store.set({ updateDialog: true })}>${t('更新する')}</button>`
            : html`<span class="tag">${t('最新です')}</span>`}
        <button class="btn sm" disabled=${busy} onClick=${checkUpdate}><${Icon} n="refresh" s=${13} /> ${t('今すぐ確認')}</button>
      </div></div>
    <div class="field"><div class="lbl">${t('自動で更新する')}<small>${t('新しい版が出たら claude update を実行します')}</small></div>
      <${Switch} on=${!!st.settings.autoUpdate} onChange=${(v) => saveSettings({ autoUpdate: v })} /></div>
    <div class="callout" style="margin:12px 0">
      ${tt('一覧は ', 'The list is read with ')}<span class="mono">claude agents --json</span>${tt('、会話は Agent SDK の ', '; conversations with the Agent SDK\'s ')}<span class="mono">getSessionMessages</span>${tt(' で読んでいます。返信は ', '. Replies run ')}<span class="mono">claude stop</span>${tt(' のあと ', ', then ')}<span class="mono">claude --bg --resume ${'<ID>'}</span>${tt(' で、同じ ID のまま続きます。', ', and continue with the same ID.')}
    </div>
    <div class="field"><div class="lbl">${t('データの場所')}<small>${t('未読・送る予定の返信・設定')}</small></div><div class="mono" style="font-size:12px;word-break:break-all">${st.dataDir}</div></div>
    <div class="field"><div class="lbl">${t('サーバーを止める')}<small>${tt('裏セッションは止まりません（claude の daemon が動かしています）。次は start.cmd で起動', "Background sessions keep running (Claude's daemon runs them). Start again with start.cmd")}</small></div>
      <div><button class="btn danger" onClick=${async () => {
        if (st.bg.list.some((a) => a.queue?.length) && !window.confirm(tt('送る予定の返信があります。止めると、次に起動するまで送られません。止めますか？', 'There are queued replies. If you stop, they will not be sent until the next start. Stop anyway?'))) return;
        await api('/api/shutdown', {});
        toast(t('サーバーを止めました。ウィンドウを閉じてください'));
      }}><${Icon} n="power" s=${14} /> ${t('止める')}</button></div></div>
  </div>`;
}

export function SettingsDialog() {
  const d = store.state.dialog;
  const tabs = [['general', '一般', 'settings'], ['keys', 'キー操作', 'keyboard'], ['look', '表示', 'eye'], ['about', 'このアプリについて', 'help']];
  return html`<div class="overlay center" onMouseDown=${() => store.set({ dialog: null })}>
    <div class="dialog" onMouseDown=${(e) => e.stopPropagation()}>
      <nav><div class="h">${t('設定')}</div>${tabs.map(([id, label, icon]) => html`<button class=${d.tab === id ? 'on' : ''} onClick=${() => store.set({ dialog: { tab: id } })}><${Icon} n=${icon} s=${15} />${t(label)}</button>`)}</nav>
      <div class="pane">${d.tab === 'keys' ? html`<${Keys} />` : d.tab === 'look' ? html`<${Look} />` : d.tab === 'about' ? html`<${About} />` : html`<${General} />`}</div>
    </div>
  </div>`;
}
