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
 *  The upstream is fixed at construction time; no request can choose a destination.
 *
 *  Two modes (exactly one per process):
 *   - actor (test scenarios): the page's Authorization is DROPPED and the scenario actor's token is attached;
 *   - login (Google sign-in, 2026-11-28): the proxy holds NO token at all. It forwards the page's own
 *     `Authorization: Bearer <ID token>` (issued to the signed-in user by Firebase Authentication) unchanged, and
 *     nothing else; a request without one is forwarded without Authorization (the API then refuses it). The API
 *     verifies the token and authorizes every request itself. */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const API_PATHS = Object.freeze(['/v1/read', '/v1/commit', '/v1/receipt']);
export const MAX_BODY = 64 * 1024;
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const BASE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
/** CSP. Emulator login mode additionally lets the page reach the Auth Emulator (sign-in REST + iframe).
 *  REAL Google sign-in (SPEC §12.3, L-3) needs Google's sign-in hosts: the SDK's popup loads apis.google.com and an
 *  iframe from the project's authDomain, and calls identitytoolkit / securetoken. Nothing else is allowed. */
export const csp = (authOrigin = null, realAuthDomain = null) => {
  if (realAuthDomain) {
    return `default-src 'self'; script-src 'self' https://apis.google.com; style-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com; img-src 'self'; frame-src https://${realAuthDomain} https://apis.google.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
  }
  return `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'${authOrigin ? ` ${authOrigin}` : ''}; img-src 'self'; frame-src ${authOrigin || "'none'"}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
};
const AUTH_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{3,61}\.(firebaseapp\.com|web\.app)$/;
/** the page's own token: one Bearer credential of JWT characters (emulator tokens have an empty signature) */
const PAGE_BEARER_RE = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/** @param o.port         listening port on 127.0.0.1
 *  @param o.upstream     fixed upstream origin (the controlled API's front proxy), loopback only
 *  @param o.token        actor mode: the scenario actor's Auth Emulator token (memory only); login mode: MUST be absent
 *  @param o.scenario     scenario code shown in the page banner (e.g. 'S-LEAVE-SC01', 'LOGIN')
 *  @param o.login        login mode: { authOrigin: 'http://127.0.0.1:9099', firebase: { apiKey, projectId, authDomain },
 *                        emulatorAccounts: [{ email, name }] (fictional accounts for the emulator sign-in chooser) }
 *  @param o.webRoot      directory with the allow-listed static files
 *  @param o.staticFiles  { '/url': 'file-in-webRoot' } allow-list */
export function createWebProxy({ port, upstream, token, scenario, webRoot, staticFiles, login = null }) {
  const up = new URL(upstream);
  if (up.protocol !== 'http:' || up.hostname !== '127.0.0.1') throw new Error('proxy: upstream must be http://127.0.0.1:<port>');
  let realAuthDomain = null;
  if (login) {
    if (token !== undefined && token !== null) throw new Error('proxy: login mode holds no token');
    if (login.real) {
      // REAL Google sign-in against a development Firebase project (no emulator)
      if (login.authOrigin) throw new Error('proxy: real sign-in and an emulator auth origin are exclusive');
      if (!AUTH_DOMAIN_RE.test(login.firebase?.authDomain || '')) throw new Error('proxy: real sign-in needs authDomain <project>.firebaseapp.com');
      realAuthDomain = login.firebase.authDomain;
    } else {
      const a = new URL(login.authOrigin);
      if (a.protocol !== 'http:' || a.hostname !== '127.0.0.1' || a.pathname !== '/' || `${a.protocol}//${a.host}` !== login.authOrigin) throw new Error('proxy: authOrigin must be http://127.0.0.1:<port>');
    }
  } else if (typeof token !== 'string' || !token) throw new Error('proxy: token missing');
  const SECURITY_HEADERS = { ...BASE_HEADERS, 'content-security-policy': csp(login && !login.real ? login.authOrigin : null, realAuthDomain) };
  const pageConfig = JSON.stringify(!login ? { scenario }
    : login.real ? { scenario, mode: 'login', firebase: login.firebase, projectLabel: login.firebase.projectId }
      : { scenario, mode: 'login', firebase: login.firebase, authEmulator: login.authOrigin, emulatorAccounts: login.emulatorAccounts || [] });
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
      if (target === '/scenario.json') return send(res, 200, pageConfig, 'application/json; charset=utf-8', head);
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
        // actor mode: the page's Authorization (if any) is NOT copied; only the scenario token is attached here.
        // login mode: ONLY the page's own Bearer token is copied (well-formed, ≤ 8 KiB); the proxy adds nothing.
        const headers = { 'content-type': 'application/json' };
        if (!login) headers.authorization = `Bearer ${token}`;
        else { const a = req.headers.authorization; if (typeof a === 'string' && a.length <= 8192 && PAGE_BEARER_RE.test(a)) headers.authorization = a; }
        const r = await fetch(`${up.origin}${p}`, { method: 'POST', headers, body: Buffer.concat(chunks), redirect: 'error', signal: AbortSignal.timeout(20000) });
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
