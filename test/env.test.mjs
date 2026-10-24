// lib/env.mjs の cleanEnv。Claude Code の中から起動されたときの変数を、子の claude に渡さない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEnv } from '../lib/env.mjs';

test('セッション由来の変数は落とし、それ以外は残す', () => {
  process.env.CLAUDECODE = '1';
  process.env.CLAUDE_CODE_SESSION_ID = 'abc';
  process.env.ELECTRON_RUN_AS_NODE = '1';
  process.env.AVC_TEST_KEEP = 'yes';
  try {
    const env = cleanEnv();
    assert.equal(env.CLAUDECODE, undefined);
    assert.equal(env.CLAUDE_CODE_SESSION_ID, undefined);
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(env.AVC_TEST_KEEP, 'yes');
  } finally {
    delete process.env.CLAUDECODE;
    delete process.env.CLAUDE_CODE_SESSION_ID;
    delete process.env.ELECTRON_RUN_AS_NODE;
    delete process.env.AVC_TEST_KEEP;
  }
});

test('追加の変数は上書きできる', () => {
  assert.equal(cleanEnv({ AVC_TEST_EXTRA: '1' }).AVC_TEST_EXTRA, '1');
});
