// getSessionMessages() の会話を、画面に出す項目に変える

const META_RE = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|system-reminder|task-notification|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook|teammate-message|channel)\b/;
const INTERRUPT_RE = /^\[Request interrupted by user/;
// 止めてから再開したとき（このアプリの返信）に Claude Code が残す印
const TOOL_CUT_RE = /^\[Tool call interrupted/;
const NO_RESPONSE_RE = /^No response requested\.?$/;
const SUMMARY_RE = /^This session is being continued from a previous conversation/;
const MAX_RESULT = 20000;

export function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b?.type === 'text' ? b.text : b?.type === 'image' ? '[画像]' : '')).filter(Boolean).join('\n');
}

function clip(s, n) {
  return s.length > n ? `${s.slice(0, n)}\n…（あと ${s.length - n} 文字）` : s;
}

// ツールの呼び出しを一行で
export function toolBrief(name, input = {}) {
  const v = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt ?? '';
  return `${name}${v ? ` ${String(v).split('\n')[0].slice(0, 80)}` : ''}`;
}

export class Normalizer {
  constructor() {
    this.items = [];
    this.byId = new Map();
    this.tools = new Map();
    this.seq = 0;
  }

  put(item) {
    item.seq = ++this.seq;
    const old = this.byId.get(item.id);
    if (old) return Object.assign(old, item);
    this.items.push(item);
    this.byId.set(item.id, item);
    return item;
  }

  touch(item) {
    item.seq = ++this.seq;
    return item;
  }

  addUser(id, text, images = 0, ts = Date.now()) {
    return this.put({ id, kind: 'user', text, images, ts });
  }

  addNote(id, level, text, ts = Date.now(), detail) {
    return this.put({ id, kind: 'note', level, text, detail, ts });
  }

  userText(id, text, images, ts) {
    if (INTERRUPT_RE.test(text)) return this.addNote(id, 'info', '中断しました', ts);
    if (SUMMARY_RE.test(text)) return this.addNote(id, 'info', 'これまでの会話を要約して続けています', ts, text);
    if (META_RE.test(text) && !images) return null;
    // 質問の途中で止めて、答えを普通のメッセージで送ったときは、その質問の答えとして見せる
    if (this.cutAsk) {
      this.cutAsk.answered = text;
      this.cutAsk = null;
    }
    return this.addUser(id, text, images, ts);
  }

  // m: { type: 'user' | 'assistant', uuid, message: { content }, parent_tool_use_id }
  ingest(m, ts = Date.now()) {
    const out = [];
    const content = m.message?.content;
    if (m.parent_tool_use_id) {
      const parent = this.tools.get(m.parent_tool_use_id);
      if (parent && m.type === 'assistant' && Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === 'tool_use') {
            parent.sub = (parent.sub || 0) + 1;
            parent.subLast = toolBrief(b.name, b.input);
          }
        }
        out.push(this.touch(parent));
      }
      return out;
    }
    if (m.type === 'assistant') {
      if (m.message?.model === '<synthetic>' && NO_RESPONSE_RE.test(textOf(content).trim())) return out;
      (Array.isArray(content) ? content : []).forEach((b, i) => {
        const id = `${m.uuid}:${i}`;
        if (b?.type === 'text' && b.text?.trim()) {
          out.push(this.put({ id, kind: 'text', text: b.text, ts }));
        } else if (b?.type === 'tool_use') {
          const it = this.put({ id, kind: 'tool', toolId: b.id, name: b.name, input: b.input ?? {}, result: null, ts });
          this.tools.set(b.id, it);
          out.push(it);
        }
      });
    } else if (m.type === 'user') {
      if (typeof content === 'string') {
        const it = this.userText(m.uuid, content, 0, ts);
        if (it) out.push(it);
      } else if (Array.isArray(content)) {
        const texts = [];
        let images = 0;
        for (const b of content) {
          if (b?.type === 'tool_result') {
            const t = this.tools.get(b.tool_use_id);
            if (t) {
              t.result = { text: clip(textOf(b.content), MAX_RESULT), isError: !!b.is_error };
              if (t.name === 'AskUserQuestion' && TOOL_CUT_RE.test(t.result.text)) this.cutAsk = t;
              out.push(this.touch(t));
            }
          } else if (b?.type === 'text') texts.push(b.text);
          else if (b?.type === 'image') images++;
        }
        if (texts.length || images) {
          const it = this.userText(m.uuid, texts.join('\n'), images, ts);
          if (it) out.push(it);
        }
      }
    }
    return out;
  }
}
