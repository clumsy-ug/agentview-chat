// キー操作の既定（mod = Ctrl）
export const COMMANDS = [
  { id: 'composer.send', label: '送信', def: 'mod+enter', when: 'composer', group: '入力欄' },
  { id: 'composer.steer', label: '作業を止めて、今すぐ送る', def: 'mod+shift+enter', when: 'composer', group: '入力欄', note: '作業中に送ると、ふつうは今の作業が終わってから送ります' },
  { id: 'session.interrupt', label: '作業を止める（claude stop）', def: 'escape', when: 'session', group: '裏セッション', note: '会話は残ります。返信すると続きから動きます' },
  { id: 'session.terminal', label: 'ターミナルで開く（claude attach）', def: '', group: '裏セッション' },
  { id: 'chat.new', label: '新しい裏セッション', def: 'mod+shift+o', group: '全体' },
  { id: 'palette.toggle', label: '裏セッションを探す', def: 'mod+k', group: '全体' },
  { id: 'session.prev', label: '前のセッション', def: 'alt+arrowup', group: '全体' },
  { id: 'session.next', label: '次のセッション', def: 'alt+arrowdown', group: '全体' },
  { id: 'session.nextNeeds', label: '入力待ちのセッションへ', def: 'alt+i', group: '全体' },
  { id: 'focus.list', label: '一覧に移る', def: 'mod+shift+l', group: '全体' },
  { id: 'focus.composer', label: '入力欄に移る', def: '/', when: 'noinput', group: '全体' },
  { id: 'sidebar.toggle', label: '一覧の表示・非表示', def: 'mod+b', group: '全体' },
  { id: 'settings.open', label: '設定', def: 'mod+,', group: '全体' },
  { id: 'theme.toggle', label: 'ダーク・ライトの切り替え', def: 'mod+alt+shift+a', group: '全体' },
  { id: 'peek.toggle', label: 'のぞき見（peek）', def: 'space', when: 'list', group: '一覧（一覧にいるとき）' },
  { id: 'session.open', label: '開く', def: 'enter', when: 'list', group: '一覧（一覧にいるとき）' },
];

// ブラウザ（Chrome）が先に使ってしまい、ページでは受け取れないキー
export const RESERVED = new Set(['mod+w', 'mod+t', 'mod+n', 'mod+shift+n', 'mod+shift+t', 'mod+shift+w', 'mod+tab', 'mod+shift+tab', 'mod+pageup', 'mod+pagedown',
  'alt+f4', 'mod+shift+i', 'mod+shift+j', 'mod+shift+c', 'f12', 'mod+shift+delete', 'mod+shift+q']);

const KEY_NAMES = { ' ': 'space', escape: 'escape', esc: 'escape', '+': 'plus' };

export function comboOf(e) {
  const k0 = e.key;
  if (!k0 || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'Process', 'Dead', 'Unidentified'].includes(k0)) return null;
  let k = KEY_NAMES[k0] ?? KEY_NAMES[k0.toLowerCase()] ?? k0.toLowerCase();
  // Shift+数字などで記号に変わったキーは、物理キーの文字に戻す
  if (e.shiftKey && /^Digit\d$/.test(e.code)) k = e.code.slice(5);
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(k);
  return parts.join('+');
}

const LABEL = { mod: 'Ctrl', alt: 'Alt', shift: 'Shift', enter: 'Enter', escape: 'Esc', space: 'Space', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
  backspace: 'Backspace', delete: 'Del', tab: 'Tab', plus: '+' };
export function comboParts(combo) {
  if (!combo) return [];
  return combo.split('+').filter(Boolean).map((p) => LABEL[p] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)));
}
export const comboText = (combo) => comboParts(combo).join(' + ') || '未設定';

export function bindingsOf(settings) {
  const out = {};
  for (const c of COMMANDS) out[c.id] = settings?.keybindings?.[c.id] ?? c.def;
  return out;
}

// 同じキーに、同時に効く操作が2つ以上あるか
export function conflicts(bindings) {
  const overlap = (a, b) => !a || !b || a === b || (a === 'noinput' && b !== 'composer') || (b === 'noinput' && a !== 'composer');
  const out = {};
  for (const a of COMMANDS) {
    for (const b of COMMANDS) {
      if (a.id >= b.id || !bindings[a.id] || bindings[a.id] !== bindings[b.id]) continue;
      if (!overlap(a.when, b.when)) continue;
      (out[a.id] ??= []).push(b.label);
      (out[b.id] ??= []).push(a.label);
    }
  }
  return out;
}
