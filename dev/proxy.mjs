/** W1 development proxy (SPEC §3 「本機代理的邊界」). Loopback only. Development use only — not a product feature.
 *
 *  - Every request: Host must be 127.0.0.1:<port> or localhost:<port> (DNS-rebinding defence) → else 403.
 *  - Static GET / HEAD: only the allow-listed files; normal top-level navigation (Sec-Fetch-Site: none) works; static
 *    responses never contain a token or test data and never reach the upstream.
 *  - API POST: exactly /v1/read, /v1/commit, /v1/receipt; Content-Type application/json; body ≤ 64 KiB; Origin MUST be
 *    present and equal this proxy's own origin; Sec-Fetch-Site, when present, must be same-origin → else 403, nothing
 *    forwarded. The page's own Authorization header is dropped; the proxy adds the scenario actor's token, which exists
 *    only in this process's memory (the page never receives it).
 *  - Paths are matched on the RAW request-target, exactly (WEB2-REV-001): no URL parsing or normalisation, so
 *    dot-segments, fragments, absolute-form, query strings, encodings etc. never match → 404, nothing forwarded.
 *  - Everything else: 404, nothing forwarded. No CORS headers are ever sent. A failure inside the handler answers a
 *    controlled 500 (static) / 502 (API) and never ends the process.
 *  The upstream is fixed at construction time; no request can choose a destination. */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const API_PATHS = Object.freeze(['/v1/read', '/v1/commit', '/v1/receipt']);
export const MAX_BODY = 64 * 1024;
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

/** @param o.port         listening port on 127.0.0.1
 *  @param o.upstream     fixed upstream origin (the controlled API's front proxy), loopback only
 *  @param o.token        the scenario actor's Auth Emulator token (memory only)
 *  @param o.scenario     scenario code shown in the page banner (e.g. 'S-LEAVE-SC01')
 *  @param o.webRoot      directory with the allow-listed static files
 *  @param o.staticFiles  { '/url': 'file-in-webRoot' } allow-list */
export function createWebProxy({ port, upstream, token, scenario, webRoot, staticFiles }) {
  const up = new URL(upstream);
  if (up.protocol !== 'http:' || up.hostname !== '127.0.0.1') throw new Error('proxy: upstream must be http://127.0.0.1:<port>');
  if (typeof token !== 'string' || !token) throw new Error('proxy: token missing');
  const stats = { forwarded: 0, rejected: 0 };
  const files = new Map(Object.entries(staticFiles).map(([u, f]) => [u, path.join(webRoot, f)]));
  let server; let boundPort = port;
  const hosts = () => new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`]);
  const origins = () => new Set([`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`]);

  const send = (res, status, body, type = 'application/json; charset=utf-8', head = false) => {
    res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type });
    res.end(head ? undefined : body);
  };
  const reject = (res, status) => { stats.rejected += 1; send(res, status, JSON.stringify({ code: status === 404 ? 'NOT_FOUND' : 'FORBIDDEN' })); };

  const handle = (req, res) => {
    const host = req.headers.host || '';
    if (!hosts().has(host)) return reject(res, 403);
    // RAW request-target, compared exactly against the allow-lists; never parsed (WEB2-REV-001)
    const target = req.url;
    if (req.method === 'GET' || req.method === 'HEAD') {
      const head = req.method === 'HEAD';
      if (target === '/scenario.json') return send(res, 200, JSON.stringify({ scenario }), 'application/json; charset=utf-8', head);
      if (!files.has(target)) return reject(res, 404);
      const f = files.get(target);
      let data;
      try { data = readFileSync(f); } catch { return send(res, 500, JSON.stringify({ code: 'INTERNAL' })); }
      return send(res, 200, data, STATIC_TYPES[path.extname(f)] || 'application/octet-stream', head);
    }
    if (req.method !== 'POST' || !API_PATHS.includes(target)) return reject(res, 404);
    const p = target;
    const origin = req.headers.origin;
    // exact string comparison only: the Origin must be this proxy's origin with the SAME host as the Host header
    if (typeof origin !== 'string' || !origins().has(origin) || origin !== `http://${host}`) return reject(res, 403);
    const sfs = req.headers['sec-fetch-site'];
    if (sfs !== undefined && sfs !== 'same-origin') return reject(res, 403);
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') return reject(res, 403);
    if (Number(req.headers['content-length'] || 0) > MAX_BODY) { stats.rejected += 1; res.setHeader('connection', 'close'); send(res, 413, JSON.stringify({ code: 'FORBIDDEN' })); req.resume(); return undefined; }
    const chunks = []; let size = 0; let tooBig = false;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { tooBig = true; stats.rejected += 1; if (!res.headersSent) { res.setHeader('connection', 'close'); send(res, 413, JSON.stringify({ code: 'FORBIDDEN' })); } req.destroy(); } else chunks.push(c); });
    req.on('end', async () => {
      if (tooBig) return;
      stats.forwarded += 1;
      try {
        // the page's Authorization (if any) is NOT copied; only the scenario token is attached here
        const r = await fetch(`${up.origin}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: Buffer.concat(chunks), redirect: 'error', signal: AbortSignal.timeout(20000) });
        const text = await r.text();
        send(res, r.status, text);
      } catch {
        // upstream unreachable or connection lost: the page must treat this as "result not confirmed" (SPEC §4)
        if (!res.headersSent) send(res, 502, JSON.stringify({ code: 'UNAVAILABLE' }));
        else res.destroy();
      }
    });
    req.on('error', () => {});
    return undefined;
  };
  server = http.createServer((req, res) => {
    try { handle(req, res); } catch {
      stats.rejected += 1;
      if (!res.headersSent) send(res, 500, JSON.stringify({ code: 'INTERNAL' })); else res.destroy();
    }
  });
  // malformed HTTP from a client: answer 400 and close that socket only
  server.on('clientError', (_e, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\ncontent-length: 0\r\n\r\n'); else socket.destroy(); });
  return {
    stats,
    listen: () => new Promise((resolve, reject2) => { server.once('error', reject2); server.listen(port, '127.0.0.1', () => { boundPort = server.address().port; resolve(boundPort); }); }),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
