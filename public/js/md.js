import { h } from 'preact';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'hljs';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const marked = new Marked({ gfm: true, breaks: true });
marked.use({
  renderer: {
    code({ text, lang }) {
      const l = String(lang || '').split(/\s/)[0];
      let body;
      try {
        body = l && hljs.getLanguage(l) ? hljs.highlight(text, { language: l, ignoreIllegals: true }).value : esc(text);
      } catch {
        body = esc(text);
      }
      return `<div class="codeblock"><div class="cb-head"><span>${esc(l || 'text')}</span><button class="copy-btn" data-copy="1">コピー</button></div><pre><code>${body}</code></pre></div>`;
    },
  },
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  // 外部の画像は読み込まない（開いただけで外へアクセスし、中身を漏らす入口になる）。data: だけ許す
  if (node.tagName === 'IMG') {
    const src = node.getAttribute('src') || '';
    if (!src.startsWith('data:')) {
      node.removeAttribute('src');
      node.removeAttribute('srcset');
    }
  }
});

const cache = new Map();
export function mdToHtml(text) {
  const key = String(text ?? '');
  let out = cache.get(key);
  if (out == null) {
    out = DOMPurify.sanitize(marked.parse(key), { ADD_ATTR: ['target', 'data-copy'], FORBID_TAGS: ['style'], FORBID_ATTR: ['style'] });
    cache.set(key, out);
    if (cache.size > 1500) cache.delete(cache.keys().next().value);
  }
  return out;
}

export function Markdown({ text, cls = '' }) {
  return h('div', { class: `md ${cls}`, dangerouslySetInnerHTML: { __html: mdToHtml(text) } });
}

// コードブロックの「コピー」（どこに出ていても効くよう、document で受ける）
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-copy]');
  if (!btn) return;
  const code = btn.closest('.codeblock')?.querySelector('code')?.innerText ?? '';
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'コピーしました';
    setTimeout(() => (btn.textContent = 'コピー'), 1400);
  });
});
