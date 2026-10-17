// 母音入力ラボから Sarashina API を呼ぶための中継（手元の PC で動かす）
//
// Sarashina API はブラウザからの直接呼び出し（CORS）を受け付けていないため、
// ラボ → この中継（http://127.0.0.1:8787）→ api.sarashina.ai の順に送る。
// API キーはラボから届いたものをそのまま転送するだけで、保存も表示もしない。
//
// 使い方（Node.js 18 以上）:
//   node cors-proxy.mjs
// ラボの「中継サーバー」に http://127.0.0.1:8787 を入れる。止める時は Ctrl+C。

import http from 'node:http';

const PORT = Number(process.env.PORT) || 8787;
const UPSTREAM = process.env.UPSTREAM || 'https://api.sarashina.ai';
/** 中継を使ってよいページ（公開版のラボと、手元の開発サーバー） */
const ALLOWED_ORIGINS = [/^https:\/\/makkey\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? '';
  if (!ALLOWED_ORIGINS.some((re) => re.test(origin))) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`許可していないページからの呼び出しです: ${origin || '(origin なし)'}`);
    return;
  }
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    // https のページから手元（ローカルネットワーク）への呼び出しを許す（Chrome）
    'access-control-allow-private-network': 'true',
    // 回数制限の時に待つ秒数をラボから読めるようにする
    'access-control-expose-headers': 'retry-after',
    vary: 'origin',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (!req.url?.startsWith('/v1/')) {
    res.writeHead(404, cors);
    res.end();
    return;
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const upstream = await fetch(UPSTREAM + req.url, {
      method: req.method,
      headers: {
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
      },
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    const retryAfter = upstream.headers.get('retry-after');
    res.writeHead(upstream.status, {
      ...cors,
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      ...(retryAfter ? { 'retry-after': retryAfter } : {}),
    });
    res.end(body);
    console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.url} → ${upstream.status}`);
  } catch (e) {
    res.writeHead(502, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: `中継から Sarashina に接続できませんでした: ${e.message}` }));
    console.error(e);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Sarashina 中継を起動しました: http://127.0.0.1:${PORT}`);
  console.log('ラボの「中継サーバー」にこの URL を入れてください。止める時は Ctrl+C。');
});
