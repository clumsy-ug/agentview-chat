// サーバー側の文言（API のエラーや、画面に出る知らせ）。言語は画面から知らせる
const EN = {
  'claude コマンドが見つかりません。Claude Code を入れてください': 'The claude command was not found. Please install Claude Code',
  '形式が想定と違います': 'Unexpected format',
  'その裏セッションは一覧にありません': 'That background session is not in the list',
  '空のメッセージは送れません': 'An empty message cannot be sent',
  '送っている途中です。少し待ってください': 'A reply is being sent. Please wait a moment',
  '頼むことを書いてください': 'Write what you want to ask',
  '中断しました': 'Interrupted',
  'これまでの会話を要約して続けています': 'Continuing from a summary of the earlier conversation',
  '[画像]': '[image]',
  'claude --version が読めません': 'Could not read claude --version',
  'npm の版の形が想定と違います': 'Unexpected npm version format',
  'claude update を実行しています': 'Running claude update',
  '大きすぎます': 'Too large',
  'JSON が読めません': 'Invalid JSON',
  '知らないフォルダです': 'Unknown folder',
  '裏のサービスにつながりませんでした。タスクスケジューラの「ログオンしているかどうかにかかわらず実行する」で始まった裏のサービスが動いていると、ここからはつながりません。そのタスクの裏セッションが終わるまで待つか、タスクを「ログオンしているときのみ実行する」にしてください':
    'Could not reach the background service. If the background service was started by a Task Scheduler task set to "Run whether user is logged on or not", it cannot be reached from here. Wait until that task\'s background sessions finish, or change the task to "Run only when user is logged on"',
};

export const tl = (lang, s) => (lang === 'en' ? EN[s] ?? s : s);
export const tlt = (lang, ja, en) => (lang === 'en' ? en : ja);
