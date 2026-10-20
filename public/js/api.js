const TOKEN = document.querySelector('meta[name="avc-token"]').content;

export async function api(path, body) {
  const opt = body === undefined
    ? { headers: { 'x-avc-token': TOKEN } }
    : { method: 'POST', headers: { 'x-avc-token': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  let j = null;
  try {
    j = await r.json();
  } catch {}
  if (r.status === 403 && j?.error === 'token') location.reload();
  if (!r.ok) throw new Error(j?.error || `エラー ${r.status}`);
  return j;
}

// サーバーからの知らせ（SSE）。切れたら少しずつ間を空けてつなぎ直す
export function connect(handlers, onStatus) {
  let retry = 0;
  const open = () => {
    const es = new EventSource(`/api/events?token=${TOKEN}`);
    es.onopen = () => {
      retry = 0;
      onStatus(true);
    };
    es.onerror = () => {
      onStatus(false);
      es.close();
      setTimeout(open, Math.min(5000, 400 * 2 ** retry++));
    };
    for (const [type, fn] of Object.entries(handlers)) es.addEventListener(type, (e) => fn(JSON.parse(e.data)));
  };
  open();
}
