// Claude Code の更新。起動時と3時間おきに新しい版を確かめ、「更新する」で claude update を実行する。
// 動いている裏セッションは止めない（次に返信したときから新しい版で動く）
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

const CHECK_EVERY = 3 * 60 * 60 * 1000;
const REGISTRY = 'https://registry.npmjs.org/@anthropic-ai%2fclaude-code/latest';

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

export class Updater extends EventEmitter {
  constructor({ claude, env, dataDir, getSettings }) {
    super();
    this.claude = claude;
    this.env = env;
    this.getSettings = getSettings;
    this.file = path.join(dataDir, 'update.json');
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {}
    this.dismissed = Array.isArray(saved.dismissed) ? saved.dismissed.filter((v) => /^\d+\.\d+\.\d+$/.test(v)) : []; // 「あとで」を押した版
    this.checkedAt = saved.checkedAt ?? null;
    this.latest = /^\d+\.\d+\.\d+$/.test(saved.latest ?? '') ? saved.latest : null;
    this.current = null;
    this.status = 'idle';
    this.step = '';
    this.message = '';
    this.busy = false;
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify({ dismissed: this.dismissed.slice(-20), checkedAt: this.checkedAt, latest: this.latest }, null, 1));
  }

  state() {
    const available = !!(this.latest && this.current && compareVersions(this.latest, this.current) > 0);
    return {
      status: this.status, step: this.step, message: this.message, current: this.current, latest: this.latest, available,
      dismissed: this.dismissed, checkedAt: this.checkedAt, auto: !!this.getSettings().autoUpdate,
    };
  }

  set(patch) {
    Object.assign(this, patch);
    this.emit('change', this.state());
  }

  run(args, timeout) {
    return new Promise((resolve, reject) => {
      execFile(this.claude, args, { env: this.env, windowsHide: true, timeout, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
        const out = `${stdout || ''}${stderr || ''}`.trim();
        if (err) reject(Object.assign(new Error(out.split('\n').pop() || err.message), { out }));
        else resolve(out);
      });
    });
  }

  async readCurrent() {
    const v = /(\d+\.\d+\.\d+)/.exec(await this.run(['--version'], 20000))?.[1];
    if (!v) throw new Error('claude --version が読めません');
    this.current = v;
    return v;
  }

  start() {
    if (!this.claude) return;
    this.readCurrent().then(() => this.set({})).catch(() => {});
    setTimeout(() => this.check(), 3000).unref?.();
    setInterval(() => this.check(), CHECK_EVERY).unref?.();
  }

  async check({ manual = false } = {}) {
    if (this.busy || !this.claude) return this.state();
    this.set({ status: 'checking', message: '' });
    try {
      await this.readCurrent();
      const r = await fetch(REGISTRY, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`npm の確認に失敗しました（${r.status}）`);
      const v = String((await r.json()).version ?? '');
      if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('npm の版の形が想定と違います');
      this.latest = v;
      this.checkedAt = Date.now();
      this.save();
      const st = this.state();
      this.set({ status: st.available ? 'available' : 'uptodate', message: '' });
      if (st.available && this.getSettings().autoUpdate) this.apply({ auto: true });
    } catch (e) {
      this.set({ status: 'idle', message: manual ? `確認できませんでした（${e.message.split('\n')[0]}）` : '' });
    }
    return this.state();
  }

  async apply({ auto = false } = {}) {
    if (this.busy || !this.claude) return;
    this.busy = true;
    const from = this.current;
    try {
      this.set({ status: 'updating', step: 'claude update を実行しています', message: '' });
      const out = await this.run(['update'], 10 * 60 * 1000);
      const now = await this.readCurrent();
      if (from && compareVersions(now, from) <= 0 && this.latest && compareVersions(this.latest, now) > 0) {
        this.set({ status: 'failed', step: '', message: `更新できませんでした（${out.split('\n').filter(Boolean).pop() ?? ''}）` });
        return;
      }
      this.set({ status: 'done', step: '', message: `Claude Code ${now} に更新しました${auto ? '（自動）' : ''}。動いている裏セッションは、次に返信したときから新しい版になります` });
    } catch (e) {
      this.set({ status: 'failed', step: '', message: `更新できませんでした（${String(e.out || e.message).trim().split('\n').pop()}）` });
    } finally {
      this.busy = false;
    }
  }

  dismiss(version) {
    if (/^\d+\.\d+\.\d+$/.test(version) && !this.dismissed.includes(version)) this.dismissed.push(version);
    this.save();
    this.set({});
  }
}
