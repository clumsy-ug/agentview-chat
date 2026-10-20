import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Claude Code や Electron アプリの中から起動されたときに引き継いでしまう変数。子の claude に渡すとおかしくなる
const SESSION_VARS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_JOB_DIR|CLAUDE_EFFORT|CLAUDE_AGENT_SDK_VERSION|ELECTRON_RUN_AS_NODE|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_SOCKET|MESSAGING_TOKEN|EXECPATH|SSE_PORT|SESSION_KIND|PLUGIN_DIRS))$/;

export function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!SESSION_VARS.test(k)) env[k] = v;
  return { ...env, ...extra };
}

// ターミナルで使っている claude。見つからなければ null
export function findGlobalClaude() {
  const home = os.homedir();
  const candidates = [path.join(home, '.local', 'bin', 'claude.exe'), path.join(home, '.local', 'bin', 'claude')];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'claude.exe'));
  }
  return candidates.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  }) ?? null;
}
