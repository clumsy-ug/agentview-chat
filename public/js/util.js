import { getLang, t } from './i18n.js';

export const basename = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || '');

export function ago(t) {
  if (!t) return '';
  const en = getLang() === 'en';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return en ? 'now' : '今';
  if (s < 3600) return en ? `${Math.round(s / 60)}m` : `${Math.round(s / 60)}分`;
  if (s < 86400) return en ? `${Math.round(s / 3600)}h` : `${Math.round(s / 3600)}時間`;
  if (s < 86400 * 7) return en ? `${Math.round(s / 86400)}d` : `${Math.round(s / 86400)}日`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function dur(ms) {
  if (ms == null) return '';
  const en = getLang() === 'en';
  const s = Math.round(ms / 1000);
  if (s < 60) return en ? `${s}s` : `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return en ? `${m}m${s % 60 ? ` ${s % 60}s` : ''}` : `${m}分${s % 60 ? `${s % 60}秒` : ''}`;
  return en ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}時間${m % 60}分`;
}

export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const MODES = [
  { value: 'default', label: '確認しながら', desc: 'ファイルの変更やコマンドの前に確認します' },
  { value: 'acceptEdits', label: '編集は自動で許可', desc: 'ファイルの編集は確認なし、コマンドは確認します' },
  { value: 'plan', label: '計画だけ', desc: '読むだけで変更しません。計画を出して止まります' },
  { value: 'auto', label: '自動判定', desc: '安全そうな操作は自動で許可します' },
  { value: 'bypassPermissions', label: 'Full access', desc: '確認なしで何でも実行します' },
];
export const modeLabel = (v) => t(MODES.find((m) => m.value === v)?.label ?? v);

export const EFFORTS = [
  { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }, { value: 'xhigh', label: 'とても高い' }, { value: 'max', label: '最大' },
];
export const effortLabel = (v) => t(EFFORTS.find((e) => e.value === v)?.label ?? v);

export function modelLabel(models, v) {
  if (!v) return '';
  const hit = (models || []).find((m) => m.value === v);
  if (hit) return hit.label;
  const alias = /^(opus|sonnet|haiku|fable)(\[1m\])?$/i.exec(v);
  if (alias) return `${alias[1][0].toUpperCase()}${alias[1].slice(1).toLowerCase()}${alias[2] ? ' (1M)' : ''}`;
  return v.replace(/^claude-/, '').replace(/-(\d+)-(\d+)/, ' $1.$2').replace(/^\w/, (c) => c.toUpperCase());
}

export const STATUS_LABEL = { needs: '入力待ち', working: '作業中', sending: '送信中', done: '完了', error: 'エラー', stopped: '停止', idle: '' };
export const statusLabel = (v) => t(STATUS_LABEL[v] || '');

// 裏セッションの表示上の状態（終わっていて未読 = 完了、読んだら一覧の「最近」へ）
export function bgStatus(a) {
  if (['needs', 'working', 'sending', 'error'].includes(a.group)) return a.group;
  return a.unread ? 'done' : 'idle';
}

// 新しい裏セッションで選べるモデル（claude --model に渡す別名）
export const MODELS = [
  { value: 'opus', label: 'Opus' }, { value: 'opus[1m]', label: 'Opus (1M)' }, { value: 'sonnet', label: 'Sonnet' },
  { value: 'sonnet[1m]', label: 'Sonnet (1M)' }, { value: 'haiku', label: 'Haiku' }, { value: 'fable', label: 'Fable' },
];

export function relPath(p, cwd) {
  if (!p) return '';
  const a = String(p).replace(/\//g, '\\');
  const base = String(cwd || '').replace(/\//g, '\\').replace(/\\+$/, '');
  if (base && a.toLowerCase().startsWith(`${base.toLowerCase()}\\`)) return a.slice(base.length + 1).replace(/\\/g, '/');
  return a;
}

export const firstLine = (s) => String(s ?? '').split('\n').find((l) => l.trim()) ?? '';

export function countLines(s) {
  return s ? String(s).split('\n').length : 0;
}

// _ は強調の記号のときだけ消す（run_in_background のような語の中の _ は残す）
export function plainPreview(md, n = 200) {
  return String(md || '').replace(/```[\s\S]*?```/g, getLang() === 'en' ? ' [code] ' : ' [コード] ').replace(/[#*`>|]/g, '').replace(/(^|[^A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, '$1')
    .replace(/\s+/g, ' ').trim().slice(0, n);
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// claude agents --json の waitingFor（英語の決まり文句）を表示言語に
const WAIT = { 'input needed': '返事を待っています', 'permission needed': '許可を待っています', 'approval needed': '許可を待っています',
  'dialog open': '確認の画面で止まっています', 'sandbox request': 'ネットワークの許可を待っています' };
const WAIT_EN = { 'input needed': 'Waiting for a reply', 'permission needed': 'Waiting for permission', 'approval needed': 'Waiting for permission',
  'dialog open': 'Stopped at a confirmation dialog', 'sandbox request': 'Waiting for network permission' };
export const waitText = (w) => (getLang() === 'en'
  ? WAIT_EN[String(w || '').toLowerCase()] ?? (w || 'Waiting for a reply')
  : WAIT[String(w || '').toLowerCase()] ?? (w || '返事を待っています'));

// 入力待ちのうち、許可や計画の承認などターミナルでしか答えられないもの（質問や、返事を待っているだけのものは除く）
export const needsTerminal = (a) => a.group === 'needs' && !a.question?.length && Boolean(a.waitingFor || a.status === 'waiting' || a.pendingTool);
