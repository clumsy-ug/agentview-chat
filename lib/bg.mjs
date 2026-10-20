// claude --bg の裏セッションを扱う。使うのは公式のコマンドと SDK だけ。
//   一覧: claude agents --json --all（kind が background のもの）
//   会話: getSessionMessages()
//   返信: claude stop <id> のあと claude --bg --resume <session-id> -- <文>（同じ ID のまま続く）
//   新規: claude --bg -- <文>、停止: claude stop、削除: claude rm、ターミナル: claude attach
import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { Normalizer, toolBrief } from './normalize.mjs';

const ID_RE = /^[0-9a-zA-Z-]{4,64}$/;
const SESSION_RE = /^[0-9a-f-]{36}$/;
const MODELS = /^(opus|sonnet|haiku|fable)(\[1m\])?$|^claude-[a-z0-9.[\]-]+$/;
const MODES = new Set(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (status, message) => Object.assign(new Error(message), { status });
// タスクスケジューラの「ログオンしているかどうかにかかわらず実行する」で daemon が起動すると、
// デスクトップからはつながらずこのエラーになる（2.1.304 時点）
const UNREACHABLE_RE = /Couldn't reach the background service/i;
const UNREACHABLE_HINT = '裏のサービスにつながりませんでした。タスクスケジューラの「ログオンしているかどうかにかかわらず実行する」で始まった裏のサービスが動いていると、ここからはつながりません。そのタスクの裏セッションが終わるまで待つか、タスクを「ログオンしているときのみ実行する」にしてください';

function groupOf(a) {
  if (a.state === 'blocked' || a.status === 'waiting' || a.waitingFor) return 'needs';
  if (a.state === 'working' || (!a.state && a.status === 'busy')) return 'working';
  if (['failed', 'error', 'crashed'].includes(a.state)) return 'error';
  if (a.state === 'stopped') return 'stopped';
  return 'done';
}

function shape(a) {
  const r = {
    id: String(a.id ?? ''), sessionId: String(a.sessionId ?? ''), name: String(a.name ?? ''), cwd: String(a.cwd ?? ''),
    state: String(a.state ?? ''), status: String(a.status ?? ''), waitingFor: String(a.waitingFor ?? ''), needs: String(a.needs ?? ''),
    startedAt: Number(a.startedAt) || null, alive: Number(a.pid) > 0,
  };
  r.group = groupOf(r);
  // 回答は終わっていて、run_in_background のコマンドだけが動いている
  r.bgBusy = r.group === 'done' && r.status === 'busy';
  return r;
}

// 会話の項目から、一覧と peek に出す要点を取り出す
function summarize(items) {
  const sum = { lastUser: '', lastText: '', activity: '', question: null, pendingTool: null, firstPrompt: '', lastAt: null, turnAt: null, endedWithText: false };
  sum.firstPrompt = items.find((it) => it.kind === 'user')?.text ?? '';
  sum.lastAt = items.reduce((t, it) => Math.max(t, it.ts || 0), 0) || null;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'user') {
      sum.lastUser = it.text;
      sum.turnAt = it.ts || null;
      break;
    }
    if (it.kind === 'text' && !sum.lastText) sum.lastText = it.text;
  }
  const last = items[items.length - 1];
  sum.endedWithText = last?.kind === 'text';
  if (last?.kind === 'tool' && !last.result) {
    if (last.name === 'AskUserQuestion') sum.question = last.input?.questions ?? null;
    else sum.pendingTool = { name: last.name, brief: toolBrief(last.name, last.input) };
    sum.activity = toolBrief(last.name, last.input);
  }
  return sum;
}

export class BgSessions extends EventEmitter {
  constructor({ claude, env, dataDir, onlyCwd }) {
    super();
    this.claude = claude;
    // 録画・テスト用。このフォルダで始まったものだけ出す
    this.listArgs = ['agents', '--json', '--all', ...(onlyCwd ? ['--cwd', onlyCwd] : [])];
    this.env = env;
    this.file = path.join(dataDir, 'bg.json');
    this.raw = [];
    this.error = claude ? '' : 'claude コマンドが見つかりません。Claude Code を入れてください';
    this.loaded = false;
    this.items = new Map(); // sessionId -> { at, items, sum }
    this.viewing = new Map(); // id -> 開いている画面の数（開いている間は未読にしない）
    // id -> 会話の記録があるセッション ID。返信で再開する途中、claude agents は記録の無い仮の ID を
    // 一瞬返すので（2.1.304 時点）、読む先と --resume の先は元の ID のままにする
    this.sids = new Map();
    this.missing = new Map(); // id -> 一覧に見えなくなった時刻
    this.clients = 0;
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {}
    // 古い形式の bg.json も読む
    this.meta = saved.sessions ?? (saved.lastAliveAt === undefined ? saved : {});
    // 返信の途中でサーバーが止まると sending が残ってしまう
    for (const m of Object.values(this.meta)) if (m.sending) m.sending = false;
    // 閉じていたあいだに終わったものを、次の起動で未読にするのに使う
    this.lastAliveAt = saved.lastAliveAt ?? null;
  }

  // 未読・送る予定など。セッション ID は再開の途中で変わるので、id をキーにする
  m(id) {
    this.meta[id] ??= { unread: false, queue: [] };
    return this.meta[id];
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      // 一覧から10分続けて消えていたら記録も消す
      if (this.loaded) {
        const keep = new Set(this.raw.map((a) => a.id));
        for (const k of Object.keys(this.meta)) {
          if (keep.has(k)) this.missing.delete(k);
          else if (!this.missing.has(k)) this.missing.set(k, Date.now());
          else if (Date.now() - this.missing.get(k) > 10 * 60000) {
            delete this.meta[k];
            this.missing.delete(k);
          }
        }
      }
      fs.writeFile(this.file, JSON.stringify({ lastAliveAt: this.lastAliveAt, sessions: this.meta }), () => {});
    }, 300);
  }

  async hasTranscript(a) {
    try {
      return (await getSessionMessages(a.sessionId, { dir: a.cwd })).length > 0 || (await getSessionMessages(a.sessionId)).length > 0;
    } catch {
      return false;
    }
  }

  run(args, { cwd, timeout = 20000 } = {}) {
    if (!this.claude) return Promise.reject(fail(500, this.error));
    // フォルダが消えていると ENOENT になる。stop・rm・resume は cwd が無くても動く
    if (cwd && !fs.existsSync(cwd)) cwd = undefined;
    return new Promise((resolve, reject) => {
      execFile(this.claude, args, { cwd, env: this.env, windowsHide: true, timeout, maxBuffer: 32 << 20 }, (err, stdout, stderr) => {
        const out = `${stdout || ''}${stderr || ''}`.trim();
        if (err) reject(Object.assign(new Error(UNREACHABLE_RE.test(out) ? UNREACHABLE_HINT : out.split('\n').pop() || err.message), { out }));
        else resolve(out);
      });
    });
  }

  // ---- 一覧 ----
  list() {
    return this.raw.map((a) => {
      const meta = this.meta[a.id] ?? {};
      const sum = this.items.get(a.sessionId)?.sum ?? {};
      return {
        ...a, ...sum, group: meta.sending ? 'sending' : a.group, unread: !!meta.unread, changedAt: meta.changedAt ?? a.startedAt, lastAt: sum.lastAt ?? meta.changedAt ?? a.startedAt,
        queue: meta.queue ?? [], lastError: meta.lastError ?? '', title: a.name || sum.firstPrompt?.split('\n')[0]?.slice(0, 80) || a.id,
      };
    });
  }

  state() {
    return { available: !!this.claude && !this.error, error: this.error, loaded: this.loaded, list: this.list() };
  }

  changed() {
    this.emit('change', this.state());
  }

  // 画面がつながっている間は 2.5 秒おき。送る予定があるときは、画面が無くても続ける
  setClients(n) {
    this.clients = n;
    // 窓を閉じたときは watch off が届かない
    if (n === 0) this.viewing.clear();
    this.schedule(0);
  }

  schedule(ms) {
    clearTimeout(this.timer);
    const pending = Object.values(this.meta).some((m) => m.queue?.length || m.sending);
    if (!this.clients && !pending) return;
    this.timer = setTimeout(() => this.refresh().finally(() => this.schedule(this.clients ? 2500 : 6000)), ms);
  }

  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      let raw;
      try {
        const out = await this.run(this.listArgs);
        const arr = JSON.parse(out.slice(out.indexOf('[')));
        if (!Array.isArray(arr)) throw new Error('形式が想定と違います');
        raw = arr.filter((a) => a.kind === 'background' && ID_RE.test(String(a.id ?? '')) && SESSION_RE.test(String(a.sessionId ?? ''))).map(shape);
        this.error = '';
      } catch (e) {
        this.error = `claude agents --json を読めませんでした（${e.message.split('\n')[0]}）`;
        this.changed();
        return;
      }
      for (const a of raw) {
        const known = this.sids.get(a.id);
        if (known && known !== a.sessionId && !(await this.hasTranscript(a))) a.sessionId = known;
        else this.sids.set(a.id, a.sessionId);
        // 古い形式（セッション ID がキー）から移す
        if (!this.meta[a.id] && this.meta[a.sessionId]) {
          this.meta[a.id] = this.meta[a.sessionId];
          delete this.meta[a.sessionId];
        }
      }
      const before = new Map(this.raw.map((a) => [a.id, a]));
      raw.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
      this.raw = raw;
      const firstLoad = !this.loaded;
      const since = this.lastAliveAt;
      this.loaded = true;
      for (const a of raw) {
        const prev = before.get(a.id);
        const meta = this.m(a.id);
        const cached = this.items.get(a.sessionId);
        const rawMoved = !prev || prev.alive !== a.alive || prev.state !== a.state || prev.status !== a.status || prev.waitingFor !== a.waitingFor;
        const live = (a.group === 'working' && !prev?.idleDone) || a.bgBusy;
        if (!cached || rawMoved || (live && Date.now() - cached.at > 3000)) await this.load(a).catch(() => {});
        // 最後の返事が「〜で進めます」のような文だと、止まっていても working のまま残る（2.1.304 時点）。
        // idle で最後が返事なら完了とみなす
        const sum = this.items.get(a.sessionId)?.sum;
        if (a.group === 'working' && a.status === 'idle' && sum?.endedWithText && sum.lastAt > (a.startedAt ?? 0)) {
          a.group = 'done';
          a.idleDone = true;
        }
        const moved = !prev || prev.group !== a.group || prev.alive !== a.alive || prev.state !== a.state || prev.waitingFor !== a.waitingFor;
        if (moved && !meta.sending) {
          meta.changedAt = Date.now();
          const sum = this.items.get(a.sessionId)?.sum;
          const lastAt = sum?.lastAt ?? 0;
          // 始まったばかりで state が空のときも done になるので、会話が無いうちは完了にしない
          const settled = a.group === 'needs' ? true : (a.group === 'done' || a.group === 'error') && (lastAt > 0 || !!sum?.question);
          // 一覧で見ていたものが止まった
          const turned = prev && prev.group !== a.group && settled;
          // 見ていないあいだに始まって終わった（スケジューラなど）
          const appeared = !prev && !firstLoad && settled;
          // アプリを閉じていたあいだに動いていた
          const whileAway = !prev && firstLoad && settled && since && lastAt > Math.max(since, meta.seenAt ?? 0);
          if (turned || appeared || whileAway) {
            if (!this.viewing.get(a.id)) meta.unread = true;
            if (!whileAway) this.notifyLater(a);
          }
        }
        // 送る予定は完了したときだけ送る（入力待ちのときに送ると、質問の答えになってしまう）。
        // 二重に送らないよう先に外し、失敗したら戻す。長すぎるなど、直らない失敗なら捨てる
        if (a.group === 'done' && meta.queue?.length && !meta.sending) {
          const q = meta.queue;
          meta.queue = [];
          this.deliver(a, q.join('\n\n')).catch((e) => {
            if (e.status !== 400) meta.queue = q;
            this.save();
            this.changed();
          });
        }
      }
      this.lastAliveAt = Date.now();
      this.refreshedAt = Date.now();
      this.save();
      this.changed();
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  // 最後の発言を添えたいので、会話を読み直してから通知する
  notifyLater(a) {
    setTimeout(() => {
      const s = this.list().find((x) => x.id === a.id);
      if (s) this.emit('notify', { id: s.id, kind: s.group, title: s.title, text: (s.group === 'needs' && s.question?.[0]?.question) || s.lastText || s.waitingFor });
    }, 50);
  }

  find(id) {
    const a = this.raw.find((x) => x.id === id || x.sessionId === id);
    if (!a) throw fail(404, 'その裏セッションは一覧にありません');
    return a;
  }

  // 画面が無いあいだはポーリングを止めているので、一覧が古ければ読み直してから探す
  async freshFind(id) {
    if (this.raw.some((x) => x.id === id || x.sessionId === id) && Date.now() - (this.refreshedAt ?? 0) < 2000) return this.find(id);
    await this.refresh();
    return this.find(id);
  }

  async load(a) {
    let msgs = await getSessionMessages(a.sessionId, { dir: a.cwd });
    if (!msgs.length) msgs = await getSessionMessages(a.sessionId);
    const norm = new Normalizer();
    for (const msg of msgs) norm.ingest(msg, msg.timestamp ? Date.parse(msg.timestamp) : null);
    const entry = { at: Date.now(), items: norm.items, sum: summarize(norm.items) };
    this.items.set(a.sessionId, entry);
    // メモリが増え続けないよう、古いものから捨てる
    if (this.items.size > 60) {
      const oldest = [...this.items.entries()].sort((x, y) => x[1].at - y[1].at).slice(0, this.items.size - 60);
      for (const [k] of oldest) this.items.delete(k);
    }
    return entry;
  }

  async itemsOf(id) {
    const a = this.find(id);
    const hit = this.items.get(a.sessionId);
    if (hit && Date.now() - hit.at < 1000) return hit.items;
    return (await this.load(a)).items;
  }

  watch(id, on) {
    if (this.raw.some((x) => x.id === id)) this.m(id).seenAt = Date.now();
    const n = (this.viewing.get(id) ?? 0) + (on ? 1 : -1);
    if (n > 0) this.viewing.set(id, n);
    else this.viewing.delete(id);
  }

  markRead(id) {
    const meta = this.m(this.find(id).id);
    meta.seenAt = Date.now();
    if (!meta.unread) return;
    meta.unread = false;
    this.save();
    this.changed();
  }

  // ---- 返信 ----
  // 作業中なら今の作業が終わってから送る。now なら止めてすぐ送る
  async reply(id, text, { now = false } = {}) {
    text = String(text ?? '').trim();
    if (!text) throw fail(400, '空のメッセージは送れません');
    // 一覧が古いと、終わったものを作業中と見て送る予定に回してしまう
    const a = await this.freshFind(id);
    const meta = this.m(a.id);
    if (meta.sending) throw fail(409, '送っている途中です。少し待ってください');
    if (a.group === 'working' && !now) {
      meta.queue = [...(meta.queue ?? []), text];
      this.save();
      this.changed();
      this.schedule(0);
      return { queued: true };
    }
    // 今すぐ送るときは送る予定もまとめて送る（先に外し、失敗したら戻す）
    if (now && meta.queue?.length) {
      const q = meta.queue;
      meta.queue = [];
      try {
        await this.deliver(a, [...q, text].join('\n\n'));
      } catch (e) {
        meta.queue = q;
        throw e;
      }
    } else {
      await this.deliver(a, text);
    }
    this.save();
    return { queued: false };
  }

  cancelQueue(id) {
    const meta = this.m(this.find(id).id);
    meta.queue = [];
    this.save();
    this.changed();
  }

  async deliver(a, text) {
    // Windows のコマンドラインの長さの上限
    if (text.length > 30000) throw fail(400, `文が長すぎます（${text.length} 文字）。Windows の上限を超えるので送れません。短く分けて送ってください`);
    const meta = this.m(a.id);
    meta.sending = true;
    meta.lastError = '';
    meta.unread = false;
    meta.seenAt = Date.now();
    this.changed();
    try {
      // 動いたまま --resume すると写しが始まる。一覧が古いこともあるので、いつも stop して pid が消えるのを待つ
      await this.run(['stop', a.id], { cwd: a.cwd }).catch(() => {});
      for (let i = 0; i < 40; i++) {
        const out = await this.run(this.listArgs).catch(() => '[]');
        const now = JSON.parse(out.slice(out.indexOf('['))).find((x) => x.id === a.id);
        if (!now || !(Number(now.pid) > 0)) break;
        await sleep(300);
      }
      const out = await this.run(['--bg', '--resume', a.sessionId, '--', text], { cwd: a.cwd, timeout: 60000 });
      if (/started a copy/i.test(out)) throw new Error(`同じ ID で続けられず、別の写しとして始まりました（${out.split('\n').find((l) => /copy/i.test(l))?.trim()}）`);
      meta.changedAt = Date.now();
    } catch (e) {
      meta.lastError = `送れませんでした: ${e.message}`;
      throw fail(e.status || 500, meta.lastError);
    } finally {
      meta.sending = false;
      this.save();
      await this.refresh();
    }
  }

  // ---- そのほかの操作 ----
  async dispatch({ cwd, text, model, mode, effort }) {
    const dir = path.resolve(String(cwd || ''));
    if (!cwd || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw fail(400, `フォルダがありません: ${cwd}`);
    text = String(text ?? '').trim();
    if (!text) throw fail(400, '頼むことを書いてください');
    const args = ['--bg'];
    if (model) {
      if (!MODELS.test(model)) throw fail(400, `モデルの指定が正しくありません: ${model}`);
      args.push('--model', model);
    }
    if (mode) {
      if (!MODES.has(mode)) throw fail(400, `権限の指定が正しくありません: ${mode}`);
      args.push('--permission-mode', mode);
    }
    if (effort) {
      if (!EFFORTS.has(effort)) throw fail(400, `思考の深さの指定が正しくありません: ${effort}`);
      args.push('--effort', effort);
    }
    args.push('--', text);
    const out = await this.run(args, { cwd: dir, timeout: 60000 });
    const id = /backgrounded\s*·\s*([0-9a-zA-Z-]{4,64})/.exec(out)?.[1];
    if (!id) throw fail(500, `claude --bg の出力が読めませんでした: ${out.slice(0, 200)}`);
    await this.refresh();
    return id;
  }

  async stop(id) {
    const a = await this.freshFind(id);
    await this.run(['stop', a.id], { cwd: a.cwd });
    await this.refresh();
  }

  async remove(id) {
    const a = await this.freshFind(id);
    await this.run(['rm', a.id], { cwd: a.cwd });
    delete this.meta[a.id];
    this.sids.delete(a.id);
    this.items.delete(a.sessionId);
    await this.refresh();
  }

  // Windows Terminal で claude attach <id>
  async terminal(id) {
    const a = await this.freshFind(id);
    openTerminal(a.cwd, [this.claude, 'attach', a.id]);
  }
}

export function openTerminal(cwd, argv) {
  const opts = { cwd, detached: true, stdio: 'ignore', windowsHide: false };
  const child = spawn('wt.exe', ['-d', cwd, ...argv], opts);
  // Windows Terminal が無ければコンソール窓で開く
  child.on('error', () => spawn(argv[0], argv.slice(1), opts).unref());
  child.unref();
}
