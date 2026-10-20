// 入力欄
import { h } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Icon } from './icons.js';
import { comboOf, comboText } from './keys.js';
import { store, toast } from './store.js';
import { api } from './api.js';
import { EFFORTS, MODES, basename, effortLabel, modeLabel, modelLabel } from './util.js';

const html = htm.bind(h);
const textDrafts = new Map();

export function openMenu(e, items, align = 'left') {
  const r = e.currentTarget.getBoundingClientRect();
  store.set({ menu: { x: align === 'right' ? r.right : r.left, y: r.top, bottom: r.bottom, align, items } });
}

// 新しい裏セッションのモデル・権限・effort（claude --bg に渡す）
export function OptionButtons({ opts, set, models, defaults, live }) {
  const dm = defaults || {};
  const modelItems = [
    { label: `既定（${modelLabel(models, dm.model) || dm.model || '設定どおり'}）`, checked: !opts.model, onSelect: () => set({ model: '' }) },
    'sep',
    ...models.map((m) => ({ label: m.label, desc: m.description, checked: opts.model === m.value, onSelect: () => set({ model: m.value }) })),
  ];
  const modeItems = [
    { label: `既定（${modeLabel(dm.mode) || '設定どおり'}）`, checked: !opts.mode, disabled: live, onSelect: () => set({ mode: '' }) },
    'sep',
    ...MODES.map((m) => ({ label: m.label, desc: m.desc, checked: opts.mode === m.value, onSelect: () => set({ mode: m.value }) })),
  ];
  const effortItems = [
    { label: `既定（${effortLabel(dm.effort) || '自動'}）`, checked: !opts.effort, onSelect: () => set({ effort: '' }) },
    'sep',
    ...EFFORTS.map((x) => ({ label: x.label, checked: opts.effort === x.value, onSelect: () => set({ effort: x.value }) })),
  ];
  const modeNow = opts.mode || dm.mode;
  return html`
    <button class="cbtn" title="モデル" onClick=${(e) => openMenu(e, [{ header: 'モデル' }, ...modelItems])}><${Icon} n="sparkle" s=${14} /><span>${modelLabel(models, opts.model || dm.model) || '既定のモデル'}</span></button>
    <button class="cbtn" title="思考の深さ" onClick=${(e) => openMenu(e, [{ header: '思考の深さ（effort）' }, ...effortItems])}><${Icon} n="gauge" s=${14} /><span>思考 ${effortLabel(opts.effort || dm.effort) || '自動'}</span></button>
    <button class=${`cbtn${modeNow === 'bypassPermissions' ? ' warn' : ''}`} title="権限" onClick=${(e) => openMenu(e, [{ header: '権限' }, ...modeItems])}><${Icon} n="shield" s=${14} /><span>${opts.mode ? modeLabel(opts.mode) : `既定（${modeLabel(dm.mode)}）`}</span></button>`;
}

export function Composer({ id, working, bindings, onSend, onInterrupt, bar, placeholder, autoFocus, cards, minimal, hint, stopTitle }) {
  const ta = useRef();
  const [text, setText] = useState(() => textDrafts.get(id) || '');
  useEffect(() => {
    setText(textDrafts.get(id) || '');
    if (autoFocus) setTimeout(() => ta.current?.focus(), 0);
  }, [id]);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [text]);
  const submit = async (steer) => {
    const t = text;
    if (!t.trim()) return;
    setText('');
    textDrafts.delete(id);
    try {
      await onSend(t, steer);
    } catch (e) {
      setText(t);
      textDrafts.set(id, t);
      toast(e.message, 'error');
    }
  };
  const onKeyDown = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    const c = comboOf(e);
    if (c && c === bindings['composer.send']) {
      e.preventDefault();
      submit(false);
    } else if (c && c === bindings['composer.steer']) {
      e.preventDefault();
      submit(true);
    }
  };
  // 文はコマンドの引数で渡すので、画像は付けられない
  const onPaste = (e) => {
    if ([...(e.clipboardData?.items || [])].some((i) => i.kind === 'file')) toast('画像やファイルは付けられません（ファイルのパスを書いてください）');
  };
  const canSend = !!text.trim();
  return html`<div class="composer-inner">
    ${cards}
    <div class="composer" onClick=${(e) => {
      if (e.target === e.currentTarget) ta.current?.focus();
    }}>
      <textarea ref=${ta} rows="1" value=${text} placeholder=${placeholder} data-composer="1"
        onInput=${(e) => {
          setText(e.target.value);
          textDrafts.set(id, e.target.value);
        }}
        onKeyDown=${onKeyDown} onPaste=${onPaste}></textarea>
      <div class="composer-bar">
        ${bar}
        <span class="grow"></span>
        ${working && !canSend
          ? html`<button class="send-btn stop" title=${`${stopTitle || '止める'}（${comboText(bindings['session.interrupt'])}）`} onClick=${onInterrupt}><${Icon} n="stop" s=${14} /></button>`
          : html`<button class="send-btn" disabled=${!canSend} title=${`送信（${comboText(bindings['composer.send'])}）`} onClick=${() => submit(false)}><${Icon} n="arrowUp" s=${16} sw=${2.2} /></button>`}
      </div>
    </div>
    ${!minimal && html`<div class="composer-hint">
      <span>${comboText(bindings['composer.send'])} で送信${working ? ` ・ 作業中に送ると、今の作業が終わってから送ります（${comboText(bindings['composer.steer'])} なら止めて今すぐ）` : ''}</span>
      ${hint && html`<span>${hint}</span>`}
    </div>`}
  </div>`;
}

// 新しい裏セッションのフォルダ選び。入力に合わせてサブフォルダを出す
export function FolderPicker({ value, onPick, onClose }) {
  const [q, setQ] = useState(value || '');
  const [res, setRes] = useState({ dirs: [], exists: false });
  const [act, setAct] = useState(0);
  const inp = useRef();
  useEffect(() => {
    inp.current?.focus();
    inp.current?.select();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => api(`/api/dirs?prefix=${encodeURIComponent(q)}`).then((r) => {
      setRes(r);
      setAct(0);
    }).catch(() => {}), 120);
    return () => clearTimeout(t);
  }, [q]);
  const recent = store.state.recentDirs || [];
  const list = q && q !== value ? res.dirs : recent;
  const pick = (d) => {
    onPick(d);
    onClose();
  };
  return html`<div class="menu" style="position:absolute;left:0;bottom:calc(100% + 6px);width:min(560px,80vw);max-width:none" onMouseDown=${(e) => e.stopPropagation()}>
    <div style="padding:4px">
      <input ref=${inp} class="input mono" style="font-size:12.5px" value=${q} placeholder="C:\\Users\\..."
        onInput=${(e) => setQ(e.target.value)}
        onKeyDown=${(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAct(Math.min(act + 1, list.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAct(Math.max(act - 1, 0)); }
          else if (e.key === 'Tab' && list[act]) { e.preventDefault(); setQ(`${list[act]}\\`); }
          else if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            if (res.exists && (q === value || !list.length || act === -1)) pick(q.replace(/\\+$/, ''));
            else if (list[act]) pick(list[act]);
            else if (res.exists) pick(q.replace(/\\+$/, ''));
          } else if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
        }} />
    </div>
    <div class="menu-label">${q && q !== value ? 'フォルダ（Tab で中に入る）' : '最近のフォルダ'}</div>
    ${list.map((d, i) => html`<button class=${`menu-item${i === act ? ' active' : ''}`} onMouseEnter=${() => setAct(i)} onClick=${() => pick(d)}>
      <${Icon} n="folder" s=${15} /><span class="ellipsis">${basename(d)}</span><span class="muted ellipsis" style="font-size:11px;max-width:300px">${d}</span></button>`)}
    ${!list.length && html`<div class="menu-label" style="font-weight:400">${res.exists ? 'Enter でこのフォルダを使う' : '見つかりません'}</div>`}
  </div>`;
}
