// lib/updater.mjs の版の比較。更新があるかどうかの判断に使うので、文字列ではなく数として比べる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from '../lib/updater.mjs';

test('新しい版は正、古い版は負、同じ版は 0', () => {
  assert.ok(compareVersions('2.1.305', '2.1.304') > 0);
  assert.ok(compareVersions('2.1.304', '2.1.305') < 0);
  assert.equal(compareVersions('2.1.305', '2.1.305'), 0);
});

test('桁が違っても数として比べる（2.1.9 < 2.1.10）', () => {
  assert.ok(compareVersions('2.1.9', '2.1.10') < 0);
  assert.ok(compareVersions('2.1.10', '2.1.9') > 0);
});

test('メジャーとマイナーを優先し、足りない桁は 0 として扱う', () => {
  assert.ok(compareVersions('3.0.0', '2.9.9') > 0);
  assert.ok(compareVersions('2.2', '2.1.999') > 0);
  assert.equal(compareVersions('2.1', '2.1.0'), 0);
});
