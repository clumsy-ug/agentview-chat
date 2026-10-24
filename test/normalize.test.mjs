// lib/normalize.mjs。getSessionMessages() の会話を画面の項目に変える変換のうち、
// Claude Code 側の都合で変わりやすい部分（割り込みの印、メタな発言の除外、結果の切り詰め）を固定する
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Normalizer, textOf, toolBrief } from '../lib/normalize.mjs';

const user = (content, uuid = 'u1') => ({ type: 'user', uuid, message: { content } });
const assistant = (content, uuid = 'a1', extra = {}) => ({ type: 'assistant', uuid, message: { content }, ...extra });

test('textOf: 文字列・テキスト部品・画像', () => {
  assert.equal(textOf('そのまま'), 'そのまま');
  assert.equal(textOf(null), '');
  assert.equal(textOf([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb');
  assert.equal(textOf([{ type: 'image' }]), '[画像]');
  assert.equal(textOf([{ type: 'tool_use', name: 'Bash' }]), '');
});

test('toolBrief: 代表の値を1行で、80文字まで', () => {
  assert.equal(toolBrief('Bash', { command: 'npm test\nつづき' }), 'Bash npm test');
  assert.equal(toolBrief('Read', { file_path: 'C:\\x\\a.txt' }), 'Read C:\\x\\a.txt');
  assert.equal(toolBrief('Grep', {}), 'Grep');
  assert.equal(toolBrief('Bash', { command: 'x'.repeat(100) }), `Bash ${'x'.repeat(80)}`);
});

test('ふつうの発言はそのまま項目になる', () => {
  const n = new Normalizer();
  n.ingest(user('こんにちは'), 1000);
  n.ingest(assistant([{ type: 'text', text: '返事です' }]), 2000);
  assert.deepEqual(n.items.map((i) => [i.kind, i.text, i.ts]), [
    ['user', 'こんにちは', 1000],
    ['text', '返事です', 2000],
  ]);
});

test('メタな発言（system-reminder やコマンドの印）は出さない', () => {
  const n = new Normalizer();
  n.ingest(user('<system-reminder>\n内部の知らせ</system-reminder>'));
  n.ingest(user('<command-name>/clear</command-name>'));
  assert.equal(n.items.length, 0);
});

test('割り込みと要約の引き継ぎは注記になる', () => {
  const n = new Normalizer();
  n.ingest(user('[Request interrupted by user]'));
  n.ingest(user('This session is being continued from a previous conversation that ran out of context', 'u2'));
  assert.equal(n.items.length, 2);
  assert.equal(n.items[0].kind, 'note');
  assert.equal(n.items[0].text, '中断しました');
  assert.equal(n.items[1].kind, 'note');
  assert.match(n.items[1].text, /要約して続けています/);
  assert.match(n.items[1].detail, /continued from a previous conversation/);
});

test('合成の「No response requested.」は出さない', () => {
  const n = new Normalizer();
  n.ingest({ type: 'assistant', uuid: 'a9', message: { model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }] } });
  assert.equal(n.items.length, 0);
});

test('ツールの呼び出しに結果がつく', () => {
  const n = new Normalizer();
  n.ingest(assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]));
  assert.equal(n.items.length, 1);
  assert.equal(n.items[0].kind, 'tool');
  assert.equal(n.items[0].result, null);
  n.ingest(user([{ type: 'tool_result', tool_use_id: 't1', content: 'file.txt' }], 'u2'));
  assert.equal(n.items.length, 1);
  assert.deepEqual(n.items[0].result, { text: 'file.txt', isError: false });
});

test('失敗したツールの結果は isError になる', () => {
  const n = new Normalizer();
  n.ingest(assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'x' } }]));
  n.ingest(user([{ type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true }], 'u2'));
  assert.deepEqual(n.items[0].result, { text: 'boom', isError: true });
});

test('長い結果は 20000 文字で切って、残りの文字数を添える', () => {
  const n = new Normalizer();
  n.ingest(assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'x' } }]));
  n.ingest(user([{ type: 'tool_result', tool_use_id: 't1', content: 'a'.repeat(25000) }], 'u2'));
  const text = n.items[0].result.text;
  assert.ok(text.startsWith('a'.repeat(20000)));
  assert.ok(text.endsWith('…（あと 5000 文字）'));
});

test('質問の途中で止めて普通に答えたら、その答えとして残る', () => {
  const n = new Normalizer();
  n.ingest(assistant([{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [] } }]));
  n.ingest(user([{ type: 'tool_result', tool_use_id: 'q1', content: '[Tool call interrupted by user]' }], 'u2'));
  n.ingest(user('やっぱりAで', 'u3'));
  const tool = n.items.find((i) => i.kind === 'tool');
  assert.equal(tool.answered, 'やっぱりAで');
});

test('サブエージェントの中のツールは、親の手順として数える', () => {
  const n = new Normalizer();
  n.ingest(assistant([{ type: 'tool_use', id: 't1', name: 'Agent', input: { description: '調べる' } }]));
  n.ingest({ type: 'assistant', uuid: 'a2', parent_tool_use_id: 't1', message: { content: [{ type: 'tool_use', id: 's1', name: 'Read', input: { file_path: 'a.txt' } }] } });
  assert.equal(n.items.length, 1);
  assert.equal(n.items[0].sub, 1);
  assert.equal(n.items[0].subLast, 'Read a.txt');
});
