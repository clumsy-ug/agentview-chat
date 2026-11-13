// 会話の表示。終わった回のツール実行は「n 件の操作」にたたむ
import { h } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Markdown } from './md.js';
import { Icon } from './icons.js';
import { clock, countLines, dur, firstLine, needsTerminal, relPath } from './util.js';
import { t, tt } from './i18n.js';

const html = htm.bind(h);
const SPECIAL = new Set(['AskUserQuestion', 'ExitPlanMode']);

export function buildBlocks(items) {
  const blocks = [];
  let cur = null;
  for (const it of items) {
    if (it.kind === 'user') {
      cur = { key: it.id, user: it, parts: [], end: null };
      blocks.push(cur);
      continue;
    }
    if (!cur) {
      cur = { key: `s-${it.id}`, user: null, parts: [], end: null };
      blocks.push(cur);
    }
    if (it.kind === 'turn') {
      cur.end = it;
      continue;
    }
    const last = cur.parts[cur.parts.length - 1];
    if (it.kind === 'tool' && !SPECIAL.has(it.name)) {
      if (last?.type === 'work') last.tools.push(it);
      else cur.parts.push({ type: 'work', key: it.id, tools: [it] });
    } else cur.parts.push({ type: it.kind === 'tool' ? 'special' : it.kind, key: it.id, item: it });
  }
  return blocks;
}

// ---- ツールの1行表示 ----
function diffCount(a, b) {
  return { plus: countLines(b), minus: countLines(a) };
}

export function toolView(tool, cwd) {
  const i = tool.input || {};
  const p = (x) => relPath(x, cwd);
  switch (tool.name) {
    case 'Bash':
    case 'PowerShell':
      return { icon: 'terminal', verb: t('コマンド'), target: firstLine(i.command), mono: true, title: i.description || '' };
    case 'Read':
      return { icon: 'file', verb: t('読む'), target: p(i.file_path) };
    case 'Write':
      return { icon: 'filePlus', verb: t('作成'), target: p(i.file_path), extra: html`<span class="extra plus">+${countLines(i.content)}</span>` };
    case 'Edit': {
      const d = diffCount(i.old_string, i.new_string);
      return { icon: 'pencil', verb: t('編集'), target: p(i.file_path), extra: html`<span class="extra"><span class="plus">+${d.plus}</span> <span class="minus">−${d.minus}</span></span>` };
    }
    case 'MultiEdit':
      return { icon: 'pencil', verb: t('編集'), target: p(i.file_path), extra: html`<span class="extra muted">${tt(`${(i.edits || []).length} か所`, `${(i.edits || []).length} edits`)}</span>` };
    case 'NotebookEdit':
      return { icon: 'pencil', verb: t('編集'), target: p(i.notebook_path) };
    case 'Grep':
      return { icon: 'search', verb: t('検索'), target: `${i.pattern ?? ''}${i.path ? `  ·  ${p(i.path)}` : ''}`, mono: true };
    case 'Glob':
      return { icon: 'search', verb: t('ファイルを探す'), target: i.pattern, mono: true };
    case 'WebFetch':
      return { icon: 'globe', verb: t('取得'), target: i.url };
    case 'WebSearch':
      return { icon: 'globe', verb: t('Web 検索'), target: i.query };
    case 'Agent':
    case 'Task':
      return { icon: 'bot', verb: t('サブエージェント'), target: i.description || i.subagent_type || '', extra: tool.sub ? html`<span class="extra muted">${tt(`${tool.sub} 手順`, `${tool.sub} steps`)}</span>` : null };
    case 'TodoWrite': {
      const todos = i.todos || [];
      return { icon: 'list', verb: 'ToDo', target: tt(`${todos.filter((x) => x.status === 'completed').length}/${todos.length} 完了`, `${todos.filter((x) => x.status === 'completed').length}/${todos.length} done`) };
    }
    case 'Skill':
      return { icon: 'book', verb: t('スキル'), target: i.skill || i.name || '' };
    case 'ToolSearch':
      return { icon: 'search', verb: t('ツールを探す'), target: i.query || '' };
    case 'Monitor':
      return { icon: 'clock', verb: t('見張る'), target: i.description || i.command || '' };
    default: {
      if (tool.name.startsWith('mcp__')) {
        const [, server, toolName] = tool.name.split('__');
        return { icon: 'plug', verb: server, target: toolName };
      }
      const v = Object.values(i).find((x) => typeof x === 'string');
      return { icon: 'wrench', verb: tool.name, target: v ? firstLine(v).slice(0, 120) : '' };
    }
  }
}

function clipLines(s, n) {
  const lines = String(s ?? '').split('\n');
  return lines.length > n ? `${lines.slice(0, n).join('\n')}\n${tt(`…（あと ${lines.length - n} 行）`, `… (${lines.length - n} more lines)`)}` : lines.join('\n');
}

function DiffView({ path, oldText, newText }) {
  const del = String(oldText ?? '').split('\n');
  const add = String(newText ?? '').split('\n');
  return html`<div class="diff">
    ${path && html`<div class="hdr">${path}</div>`}
    ${oldText ? del.slice(0, 200).map((l) => html`<div class="del">- ${l}</div>`) : null}
    ${add.slice(0, 200).map((l) => html`<div class="add">+ ${l}</div>`)}
  </div>`;
}

function Todos({ todos }) {
  return html`<div class="todo">${(todos || []).map((t) => html`<div class=${t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : ''}>
    <span>${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'}</span><span>${t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</span></div>`)}</div>`;
}

function ResultPre({ r, lines = 80 }) {
  if (!r) return null;
  if (!r.text?.trim()) return html`<div class="muted" style="font-size:12px">${t('（出力なし）')}</div>`;
  return html`<pre class=${`pre${r.isError ? ' err' : ''}`}>${clipLines(r.text, lines)}</pre>`;
}

function toolDetail(t, cwd) {
  const i = t.input || {};
  switch (t.name) {
    case 'Bash':
    case 'PowerShell':
      return html`<pre class="pre">${i.description ? html`<span class="muted"># ${i.description}\n</span>` : ''}$ ${i.command}</pre><${ResultPre} r=${t.result} />`;
    case 'Edit':
      return html`<${DiffView} path=${relPath(i.file_path, cwd)} oldText=${i.old_string} newText=${i.new_string} />${t.result?.isError ? html`<${ResultPre} r=${t.result} />` : ''}`;
    case 'MultiEdit':
      return (i.edits || []).map((e) => html`<${DiffView} path=${relPath(i.file_path, cwd)} oldText=${e.old_string} newText=${e.new_string} />`);
    case 'Write':
      return html`<${DiffView} path=${relPath(i.file_path, cwd)} newText=${clipLines(i.content, 120)} />`;
    case 'Read':
      return html`<${ResultPre} r=${t.result} lines=${60} />`;
    case 'TodoWrite':
      return html`<${Todos} todos=${i.todos} />`;
    case 'Agent':
    case 'Task':
      return html`<pre class="pre">${clipLines(i.prompt, 30)}</pre>${t.subLast ? html`<div class="muted" style="font-size:12px">${tt('最後の操作: ', 'Last action: ')}${t.subLast}</div>` : ''}${t.result ? html`<div class="plan-box"><${Markdown} text=${t.result.text} /></div>` : ''}`;
    default:
      return html`<pre class="pre">${JSON.stringify(i, null, 2)}</pre><${ResultPre} r=${t.result} lines=${60} />`;
  }
}

function ToolRow({ t, cwd, live }) {
  const [open, setOpen] = useState(false);
  const v = toolView(t, cwd);
  const running = !t.result && live;
  const err = t.result?.isError;
  return html`<div class="tool">
    <div class="tool-line" onClick=${() => setOpen(!open)} title=${v.title || v.target || ''}>
      ${running ? html`<span class="spinner" style="color:var(--blue)"></span>` : html`<${Icon} n=${err ? 'x' : v.icon} s=${14} cls=${err ? 'err' : ''} />`}
      <span class="verb">${v.verb}</span>
      <span class=${`target${v.mono ? ' mono' : ''}`}>${v.target}</span>
      ${v.extra}
    </div>
    ${open && html`<div class="tool-detail">${toolDetail(t, cwd)}</div>`}
  </div>`;
}

function parseAnswers(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/"([^"]+)"="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function Special({ it, live, waiting }) {
  if (it.name === 'AskUserQuestion') {
    const ans = parseAnswers(it.result?.text);
    return html`<div class="qa">${(it.input?.questions || []).map((q) => html`<div>
      <div class="muted">${q.question}</div>
      ${it.answered != null && ans[q.question] == null
        ? html`<div class="a">${it.answered}</div>`
        : ans[q.question] != null || it.result
        ? html`<div class="a">${ans[q.question] ?? (it.result.isError ? t('（答えずに進みました）') : '—')}</div>`
        : live || waiting
          ? html`<div style="color:var(--amber)">${t('回答待ち')}${live ? '…' : tt(`（${(q.options || []).map((o) => o.label).join(' / ')}）`, ` (${(q.options || []).map((o) => o.label).join(' / ')})`)}</div>`
          : html`<div class="muted">${t('（答えないまま進みました）')}</div>`}
    </div>`)}</div>`;
  }
  if (it.name === 'ExitPlanMode') {
    return html`<div class="plan-box"><div class="card-head" style="color:var(--muted)"><${Icon} n="map" s=${14} /> ${t('計画')}</div>
      <${Markdown} text=${it.input?.plan || ''} />
      ${it.result && html`<div class="muted" style="font-size:12px;margin-top:6px">${it.result.isError ? t('見直しを指示しました') : t('承認しました')}</div>`}</div>`;
  }
  return null;
}

function Note({ it }) {
  const [open, setOpen] = useState(false);
  return html`<div class=${`msg-note ${it.level}`} onClick=${it.detail ? () => setOpen(!open) : undefined} style=${it.detail ? 'cursor:pointer' : ''}>
    <${Icon} n=${it.level === 'error' || it.level === 'warn' ? 'alert' : 'history'} s=${13} /><span>${it.text}</span>
    ${open && it.detail ? html`<pre class="pre" style="margin-top:6px">${it.detail}</pre>` : ''}
  </div>`;
}

function Part({ p, cwd, live, muted, waiting }) {
  if (p.type === 'work') return html`<div class="work-list">${p.tools.map((t) => html`<${ToolRow} key=${t.id} t=${t} cwd=${cwd} live=${live} />`)}</div>`;
  if (p.type === 'text') return html`<div class="msg-text" style=${muted ? 'color:var(--muted);font-size:.95em' : ''}><${Markdown} text=${p.item.text} /></div>`;
  if (p.type === 'note') return html`<${Note} it=${p.item} />`;
  if (p.type === 'special') return html`<${Special} it=${p.item} live=${live} waiting=${waiting} />`;
  return null;
}

function UserMsg({ it }) {
  return html`<div class="msg-user">${it.images ? html`<div class="imgs"><${Icon} n="image" s=${12} /> ${tt(`画像 ${it.images} 枚`, `${it.images} image${it.images > 1 ? 's' : ''}`)}</div>` : ''}${it.text}</div>`;
}

function TurnMeta({ b, tail }) {
  const text = tail.filter((p) => p.type === 'text').map((p) => p.item.text).join('\n\n');
  const [copied, setCopied] = useState(false);
  return html`<div class="turn-meta">
    ${b.end?.durationMs != null && html`<span><${Icon} n="clock" s=${12} /> ${dur(b.end.durationMs)}</span>`}
    ${text && html`<button class="copy-btn act" onClick=${() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}>
      <${Icon} n=${copied ? 'check' : 'copy'} s=${12} /> ${copied ? t('コピーしました') : t('コピー')}</button>`}
  </div>`;
}

function Turn({ b, cwd, active, expanded, onToggle, waiting }) {
  let lastWork = -1;
  b.parts.forEach((p, i) => {
    if (p.type === 'work') lastWork = i;
  });
  const head = b.parts.slice(0, lastWork + 1);
  const tail = b.parts.slice(lastWork + 1);
  const tools = head.reduce((n, p) => n + (p.type === 'work' ? p.tools.length : 0), 0);
  return html`<div class="turn">
    ${b.user && html`<${UserMsg} it=${b.user} />`}
    ${head.length > 0 && (active
      ? head.map((p) => html`<${Part} key=${p.key} p=${p} cwd=${cwd} live=${true} />`)
      : html`<div class=${`work${expanded ? ' open' : ''}`}>
          <button class="work-head" onClick=${onToggle}><${Icon} n="chevR" s=${13} cls="chev" /> ${tt(`${tools} 件の操作`, `${tools} operations`)}${b.end?.durationMs != null ? tt(`（${dur(b.end.durationMs)}）`, ` (${dur(b.end.durationMs)})`) : ''}</button>
          ${expanded && html`<div class="work-body">${head.map((p) => html`<${Part} key=${p.key} p=${p} cwd=${cwd} muted=${true} />`)}</div>`}
        </div>`)}
    ${tail.map((p) => html`<${Part} key=${p.key} p=${p} cwd=${cwd} live=${active} waiting=${waiting} />`)}
    ${b.end && !active && html`<${TurnMeta} b=${b} tail=${tail} />`}
  </div>`;
}

function WorkingLine({ s, hint }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const needs = s.status === 'needs';
  return html`<div class="working-line">
    ${needs ? html`<${Icon} n="help" s=${14} />` : html`<span class="spinner"></span>`}
    <span style=${needs ? 'color:var(--amber)' : ''}>${needs ? t('あなたの返事を待っています') : s.activity || t('作業中')}</span>
    ${s.workStartedAt && html`<span>· ${clock(Date.now() - s.workStartedAt)}</span>`}
    ${s.bgTasks ? html`<span>· ${tt(`バックグラウンドで ${s.bgTasks} 件`, `${s.bgTasks} in the background`)}</span>` : ''}
    ${!needs && hint && html`<span class="hint">${hint}</span>`}
  </div>`;
}

export function Thread({ s, items, draft, cwd, hint, readOnly, waitingLast }) {
  const ref = useRef();
  const stick = useRef(true);
  const [limit, setLimit] = useState(30);
  const [expanded, setExpanded] = useState(() => new Set());
  const blocks = useMemo(() => buildBlocks(items || []), [items]);
  const working = !readOnly && (s?.status === 'working' || s?.status === 'needs');
  const shown = blocks.slice(-limit);
  const key = s?.sid ?? s?.id;
  useEffect(() => {
    stick.current = true;
    setLimit(30);
    setExpanded(new Set());
  }, [key]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  const onScroll = () => {
    const el = ref.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  const toggle = (k) => setExpanded((old) => {
    const n = new Set(old);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  return html`<div class="thread" ref=${ref} onScroll=${onScroll}><div class="thread-inner">
    ${items == null && html`<div class="working-line" style="justify-content:center"><span class="spinner"></span> ${t('会話を読み込んでいます')}</div>`}
    ${blocks.length > limit && html`<button class="btn ghost sm" style="align-self:center" onClick=${() => {
      stick.current = false;
      setLimit(limit + 30);
    }}>${tt(`前の会話を表示（あと ${blocks.length - limit} 回分）`, `Show earlier turns (${blocks.length - limit} more)`)}</button>`}
    ${shown.map((b, i) => html`<${Turn} key=${b.key} b=${b} cwd=${cwd} active=${working && i === shown.length - 1} waiting=${readOnly && waitingLast && i === shown.length - 1}
      expanded=${expanded.has(b.key)} onToggle=${() => toggle(b.key)} />`)}
    ${working && draft ? html`<div class="msg-text"><${Markdown} text=${draft} cls="draft-caret" /></div>` : ''}
    ${working && html`<${WorkingLine} s=${s} hint=${hint} />`}
  </div></div>`;
}

// ---- 確認カード ----
let activeCard = null;
export const cardKeys = (key) => activeCard?.(key) ?? false;

export function QuestionCard({ req, onAnswer, compact }) {
  const qs = req.input?.questions || [];
  const [sel, setSel] = useState({});
  const [other, setOther] = useState({});
  const single = qs.length === 1 && !qs[0].multiSelect;
  const submit = (answers) => onAnswer({ reqId: req.reqId, answers });
  const answers = () => Object.fromEntries(qs.map((q) => {
    const typed = other[q.question]?.trim();
    const v = sel[q.question];
    return [q.question, typed || (Array.isArray(v) ? v.join(', ') : v || '')];
  }).filter(([, a]) => a));
  const choose = (q, label) => {
    if (single) return submit({ [q.question]: label });
    setSel((s) => {
      if (!q.multiSelect) return { ...s, [q.question]: label };
      const set = new Set(s[q.question] || []);
      if (set.has(label)) set.delete(label);
      else set.add(label);
      return { ...s, [q.question]: [...set] };
    });
  };
  useEffect(() => {
    if (compact) return undefined;
    const fn = (key) => {
      const n = Number(key);
      const q = qs[0];
      if (!(n >= 1 && n <= (q?.options?.length ?? 0))) return false;
      choose(q, q.options[n - 1].label);
      return true;
    };
    activeCard = fn;
    return () => {
      if (activeCard === fn) activeCard = null;
    };
  });
  const ready = Object.keys(answers()).length === qs.length;
  return html`<div class="card needs">
    <div class="card-head"><${Icon} n="help" s=${14} /> ${t('質問があります')}</div>
    ${qs.map((q, qi) => html`<div style=${qi ? 'margin-top:12px' : ''}>
      <div class="card-q">${q.question}${q.multiSelect ? html`<span class="muted" style="font-weight:400;font-size:12px">${t('（いくつでも）')}</span>` : ''}</div>
      <div class="opts">${(q.options || []).map((o, i) => {
        const v = sel[q.question];
        const on = Array.isArray(v) ? v.includes(o.label) : v === o.label;
        return html`<button class=${`opt${on ? ' on' : ''}`} onClick=${() => choose(q, o.label)}>
          <span class="num">${on && (compact || qi > 0) ? '✓' : i + 1}</span><span class="lbl">${o.label}</span>${o.description ? html`<span class="desc">${o.description}</span>` : ''}</button>`;
      })}</div>
      <div class="other"><input class="input" placeholder=${t('ほかの答えを書く')} value=${other[q.question] || ''}
        onInput=${(e) => setOther({ ...other, [q.question]: e.target.value })}
        onKeyDown=${(e) => {
          if (e.key === 'Enter' && !e.isComposing && e.target.value.trim() && single) submit({ [q.question]: e.target.value.trim() });
        }} /></div>
    </div>`)}
    ${!single || Object.values(other).some((v) => v?.trim()) ? html`<div class="card-actions"><span class="grow"></span>
      <button class="btn primary" disabled=${!ready} onClick=${() => submit(answers())}>${t('回答する')}</button></div>` : ''}
  </div>`;
}


// 止まって待っているもの。質問は選択肢で答えられるが、許可や計画の確認はターミナルでしか答えられない
export function BgPendingCard({ a, onReply, onTerminal, compact }) {
  if (a.group !== 'needs') return null;
  if (a.question?.length) {
    const req = { reqId: a.id, input: { questions: a.question } };
    const onAnswer = ({ answers }) => {
      const pairs = Object.entries(answers);
      onReply(pairs.length === 1 ? pairs[0][1] : pairs.map(([q, v]) => `${q} → ${v}`).join('\n'));
    };
    return html`<div class="cards"><${QuestionCard} req=${req} onAnswer=${onAnswer} compact=${compact} /></div>`;
  }
  if (!needsTerminal(a)) return null;
  const pt = a.pendingTool;
  const plan = pt?.name === 'ExitPlanMode';
  return html`<div class="cards"><div class="card needs">
    <div class="card-head"><${Icon} n=${plan ? 'map' : 'shield'} s=${14} /> ${plan ? t('計画の承認を待っています') : `${t('確認を待っています')}${pt ? ` · ${pt.brief}` : ''}`}</div>
    <div class="muted" style="font-size:12.5px">${tt('許可や計画の承認は、ターミナルの画面（claude attach）でしか答えられません。ここに書いて送ると、止めてから指示として続けます。', 'Permissions and plan approvals can only be answered in the terminal (claude attach). If you write and send here instead, the session is stopped and your text continues it as an instruction.')}</div>
    <div class="card-actions"><button class="btn primary" onClick=${onTerminal}><${Icon} n="terminal" s=${14} /> ${t('ターミナルで開いて答える')}</button></div>
  </div></div>`;
}
