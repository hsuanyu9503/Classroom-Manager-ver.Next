/** SPEC §3 local proxy boundaries and §6 item 11, against a fake upstream that records what it receives. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebProxy, MAX_BODY } from '../dev/proxy.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const TOKEN = 'test-token-value-not-real';
let upstream; let upPort; let proxy; let port; const seen = [];

before(async () => {
  upstream = http.createServer((req, res) => {
    let s = ''; req.on('data', (d) => { s += d; });
    req.on('end', () => { seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: s }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"code":"OK"}'); });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r)); upPort = upstream.address().port;
  proxy = createWebProxy({ port: 0, upstream: `http://127.0.0.1:${upPort}`, token: TOKEN, scenario: 'S-LEAVE-SC01', webRoot: WEB, staticFiles: { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js' } });
  port = await proxy.listen();
});
after(async () => { await proxy.close(); upstream.closeAllConnections(); await new Promise((r) => upstream.close(r)); });

/** Raw request so Host / Origin / Sec-Fetch-Site can be set exactly. */
function raw({ method = 'GET', p = '/', headers = {}, body = null }) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...headers }, setHost: false }, (x) => {
      let s = ''; x.on('data', (d) => { s += d; }); x.on('end', () => resolve({ status: x.statusCode, headers: x.headers, body: s }));
    });
    r.on('error', (e) => resolve({ status: 0, error: e.code }));
    if (body !== null) r.write(body);
    r.end();
  });
}
const ORIGIN = () => `http://127.0.0.1:${port}`;
const apiPost = (over = {}) => raw({ method: 'POST', p: '/v1/read', body: '{"op":"x"}', headers: { 'content-type': 'application/json', origin: ORIGIN(), 'sec-fetch-site': 'same-origin', ...over } });

test('item 11: direct top-level navigation (Sec-Fetch-Site: none, no Origin) serves the page; nothing forwarded', async () => {
  const n = seen.length;
  const r = await raw({ headers: { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' } });
  assert.equal(r.status, 200); assert.match(r.body, /<title>Classroom Manager ver.Next/);
  assert.ok(!r.body.includes(TOKEN)); assert.equal(r.headers['access-control-allow-origin'], undefined);
  assert.equal(seen.length, n);
});
test('static responses never contain the token; scenario.json has the scenario only', async () => {
  for (const p of ['/', '/index.html', '/app.js', '/scenario.json']) { const r = await raw({ p }); assert.equal(r.status, 200, p); assert.ok(!r.body.includes(TOKEN), p); }
  assert.deepEqual(JSON.parse((await raw({ p: '/scenario.json' })).body), { scenario: 'S-LEAVE-SC01' });
});
test('static allow-list only: other paths 404, nothing forwarded', async () => {
  const n = seen.length;
  for (const p of ['/../dev/proxy.mjs', '/dev/proxy.mjs', '/package.json', '/v1/read', '/web/app.js', '/.git/config']) assert.equal((await raw({ p })).status, 404, p);
  assert.equal(seen.length, n);
});
test('Host must be 127.0.0.1:<port> or localhost:<port> (DNS rebinding)', async () => {
  assert.equal((await raw({ headers: { host: `evil.example:${port}` } })).status, 403);
  assert.equal((await raw({ headers: { host: `127.0.0.1:${port + 1}` } })).status, 403);
  assert.equal((await raw({ headers: { host: `localhost:${port}` } })).status, 200);
});
test('item 11: same-origin API POST is forwarded with the PROXY token; the page Authorization is dropped', async () => {
  const n = seen.length;
  const r = await apiPost({ authorization: 'Bearer page-supplied-token' });
  assert.equal(r.status, 200); assert.equal(seen.length, n + 1);
  assert.equal(seen.at(-1).auth, `Bearer ${TOKEN}`); assert.equal(seen.at(-1).url, '/v1/read'); assert.equal(seen.at(-1).body, '{"op":"x"}');
});
test('item 11: cross-origin, cross-site and Origin-less API POSTs are refused and NOT forwarded', async () => {
  const n = seen.length;
  assert.equal((await apiPost({ origin: 'http://evil.example' })).status, 403);
  assert.equal((await apiPost({ origin: `http://127.0.0.1:${port + 1}` })).status, 403);
  assert.equal((await apiPost({ 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await apiPost({ 'sec-fetch-site': 'same-site' })).status, 403);
  assert.equal((await apiPost({ 'sec-fetch-site': 'none' })).status, 403);
  assert.equal((await raw({ method: 'POST', p: '/v1/read', body: '{}', headers: { 'content-type': 'application/json' } })).status, 403, 'no Origin');
  assert.equal((await apiPost({ origin: `http://localhost:${port}` })).status, 403, 'Origin host must match the Host header');
  assert.equal(seen.length, n);
});
test('API POST: only the three paths, JSON only, no query string, other methods 404; nothing forwarded', async () => {
  const n = seen.length;
  for (const p of ['/v1/other', '/v1/read/x', '/v1/read?x=1', '/']) assert.equal((await raw({ method: 'POST', p, body: '{}', headers: { 'content-type': 'application/json', origin: ORIGIN() } })).status, 404, p);
  assert.equal((await apiPost({ 'content-type': 'text/plain' })).status, 403);
  for (const m of ['PUT', 'DELETE', 'PATCH', 'OPTIONS']) assert.equal((await raw({ method: m, p: '/v1/read', headers: { origin: ORIGIN() } })).status, 404, m);
  assert.equal(seen.length, n);
});
test('body over 64 KiB is refused and not forwarded', async () => {
  const n = seen.length;
  const r = await raw({ method: 'POST', p: '/v1/read', body: 'x'.repeat(MAX_BODY + 1), headers: { 'content-type': 'application/json', origin: ORIGIN() } });
  assert.ok(r.status === 413 || r.status === 0, String(r.status));
  assert.equal(seen.length, n);
});
test('the upstream is fixed: a non-loopback upstream is refused at construction', () => {
  assert.throws(() => createWebProxy({ port: 0, upstream: 'http://example.com:80', token: 't', scenario: 's', webRoot: WEB, staticFiles: {} }));
  assert.throws(() => createWebProxy({ port: 0, upstream: `http://127.0.0.1:${upPort}`, token: '', scenario: 's', webRoot: WEB, staticFiles: {} }));
});

/* WEB2-REV-001: the RAW request-target must match exactly; URL normalisation must never let a variant through,
   and a malformed target must not end the process. Sent over a raw TCP socket so nothing rewrites the target. */
import net from 'node:net';
function rawTarget(method, target, { body = '{}', headers = {} } = {}) {
  return new Promise((resolve) => {
    const h = { host: `127.0.0.1:${port}`, origin: ORIGIN(), 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), connection: 'close', ...headers };
    const sock = net.connect(port, '127.0.0.1', () => sock.write(`${method} ${target} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${method === 'POST' ? body : ''}`));
    let s = ''; sock.on('data', (d) => { s += d; }); sock.on('close', () => resolve(Number((s.match(/^HTTP\/1\.1 (\d{3})/) || [])[1] || 0)));
    sock.on('error', () => resolve(0));
  });
}
const VARIANTS = ['/extra/../v1/read', '/v1/./read', '/v1/read#ignored', '/v1/read?x=1', 'http://different.example/v1/read', `http://127.0.0.1:${'PORT'}/v1/read`, '//v1/read', '/v1/read/', '/V1/READ', '/v1/%72ead', '/v1%2fread', '*'];
test('WEB2-REV-001: API path variants (dot-segment, fragment, query, absolute-form, encodings…) → 404, nothing forwarded', async () => {
  const n = seen.length;
  for (const v of VARIANTS) {
    const t = v.replace('PORT', String(port));
    const st = await rawTarget('POST', t);
    assert.ok(st === 404 || st === 400, `${t} → ${st}`);
  }
  assert.equal(seen.length, n, 'nothing forwarded');
  assert.equal(await rawTarget('POST', '/v1/read'), 200, 'the exact path still works');
  assert.equal(seen.length, n + 1);
});
test('WEB2-REV-001: static path variants → 404 (exact allow-list)', async () => {
  for (const t of ['/x/../index.html', '/index.html#a', '/index.html?a=1', '/./app.js', `http://127.0.0.1:${port}/app.js`, '//app.js', '/APP.JS']) {
    const st = await rawTarget('GET', t); assert.ok(st === 404 || st === 400, `${t} → ${st}`);
  }
  assert.equal(await rawTarget('GET', '/app.js'), 200);
});
test('WEB2-REV-001: malformed request-targets get a controlled answer and the proxy keeps serving', async () => {
  const n = seen.length;
  for (const t of ['http://[', 'http://[/v1/read', '%', '/v1/read%', '/%zz']) {
    for (const m of ['POST', 'GET']) { const st = await rawTarget(m, t); assert.ok([400, 404].includes(st), `${m} ${t} → ${st}`); }
  }
  assert.equal(seen.length, n);
  assert.equal(await rawTarget('GET', '/'), 200, 'still serving static');
  assert.equal(await rawTarget('POST', '/v1/read'), 200, 'still serving the API');
});

/* Google sign-in (login mode): the proxy holds NO token; it forwards only the page's own well-formed Bearer token. */
test('login mode: the page\'s own Bearer token is forwarded unchanged; no token is ever added', async () => {
  const lp = createWebProxy({ port: 0, upstream: `http://127.0.0.1:${upPort}`, scenario: 'LOGIN', webRoot: WEB, staticFiles: { '/': 'index.html' }, login: { authOrigin: 'http://127.0.0.1:9099', firebase: { apiKey: 'demo-api-key', projectId: 'demo-x', authDomain: 'demo-x.firebaseapp.com' } } });
  const lport = await lp.listen();
  const post = (headers) => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: lport, path: '/v1/read', method: 'POST', headers: { host: `127.0.0.1:${lport}`, origin: `http://127.0.0.1:${lport}`, 'content-type': 'application/json', ...headers }, setHost: false }, (x) => { x.resume(); x.on('end', () => resolve(x.statusCode)); });
    r.end('{"op":"x"}');
  });
  try {
    const userToken = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1In0.';
    let n = seen.length;
    assert.equal(await post({ authorization: `Bearer ${userToken}` }), 200);
    assert.equal(seen.at(-1).auth, `Bearer ${userToken}`, 'forwarded unchanged');
    assert.equal(await post({}), 200);
    assert.equal(seen.at(-1).auth, undefined, 'no Authorization → none forwarded (the API refuses)');
    for (const bad of ['Basic abc', 'Bearer a b', `Bearer ${userToken}\r\nx: y`.slice(0, 20), 'Bearer abc', `bearer ${userToken}`]) {
      await post({ authorization: bad }); assert.equal(seen.at(-1).auth, undefined, bad);
    }
    assert.equal(seen.length, n + 7);
    assert.ok(!seen.slice(n).some((e) => e.auth === `Bearer ${TOKEN}`), 'the actor token never appears');
    const cfg = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: lport, path: '/scenario.json', headers: { host: `127.0.0.1:${lport}` } }, (x) => { let b = ''; x.on('data', (d) => { b += d; }); x.on('end', () => resolve({ body: JSON.parse(b), csp: x.headers['content-security-policy'] })); }));
    assert.deepEqual(cfg.body, { scenario: 'LOGIN', mode: 'login', firebase: { apiKey: 'demo-api-key', projectId: 'demo-x', authDomain: 'demo-x.firebaseapp.com' }, authEmulator: 'http://127.0.0.1:9099', emulatorAccounts: [] });
    assert.ok(!JSON.stringify(cfg.body).includes(TOKEN));
    assert.match(cfg.csp, /connect-src 'self' http:\/\/127\.0\.0\.1:9099;/); assert.match(cfg.csp, /frame-src http:\/\/127\.0\.0\.1:9099;/); assert.match(cfg.csp, /script-src 'self';/);
    // cross-origin is still refused in login mode
    assert.equal(await new Promise((resolve) => { const r = http.request({ host: '127.0.0.1', port: lport, path: '/v1/read', method: 'POST', headers: { host: `127.0.0.1:${lport}`, origin: 'http://evil.example', 'content-type': 'application/json', authorization: `Bearer ${userToken}` }, setHost: false }, (x) => { x.resume(); resolve(x.statusCode); }); r.end('{}'); }), 403);
  } finally { await lp.close(); }
});
test('login mode refuses a token, and a non-loopback auth origin, at construction; actor mode CSP has no frame/auth origin', async () => {
  const base = { port: 0, upstream: `http://127.0.0.1:${upPort}`, scenario: 'LOGIN', webRoot: WEB, staticFiles: {} };
  assert.throws(() => createWebProxy({ ...base, token: 'x', login: { authOrigin: 'http://127.0.0.1:9099', firebase: {} } }));
  assert.throws(() => createWebProxy({ ...base, login: { authOrigin: 'http://example.com:9099', firebase: {} } }));
  assert.throws(() => createWebProxy({ ...base, login: { authOrigin: 'http://127.0.0.1:9099/x', firebase: {} } }));
  const r = await raw({ p: '/' });
  assert.match(r.headers['content-security-policy'], /connect-src 'self';/); assert.match(r.headers['content-security-policy'], /frame-src 'none';/);
});
test('the committed Firebase bundle equals a fresh build from the locked package (scripts/build-vendor.mjs --check)', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [path.join(WEB, '..', 'scripts', 'build-vendor.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('REAL Google sign-in mode (development project): CSP allows ONLY Google\'s sign-in hosts; no emulator config; no token held', async () => {
  const base = { port: 0, upstream: `http://127.0.0.1:${upPort}`, scenario: 'LOGIN', webRoot: WEB, staticFiles: { '/': 'index.html' } };
  assert.throws(() => createWebProxy({ ...base, login: { real: true, firebase: { authDomain: 'evil.example.com', projectId: 'p' } } }), /authDomain/);
  assert.throws(() => createWebProxy({ ...base, login: { real: true, authOrigin: 'http://127.0.0.1:9099', firebase: { authDomain: 'cmn-dev.firebaseapp.com' } } }));
  assert.throws(() => createWebProxy({ ...base, token: 't', login: { real: true, firebase: { authDomain: 'cmn-dev.firebaseapp.com' } } }));
  const rp = createWebProxy({ ...base, login: { real: true, firebase: { apiKey: 'k', authDomain: 'cmn-dev.firebaseapp.com', projectId: 'cmn-dev', appId: 'a' } } });
  const p = await rp.listen();
  try {
    const r = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: p, path: '/scenario.json', headers: { host: `127.0.0.1:${p}` } }, (x) => { let b = ''; x.on('data', (d) => { b += d; }); x.on('end', () => resolve({ body: JSON.parse(b), csp: x.headers['content-security-policy'] })); }));
    assert.deepEqual(r.body, { scenario: 'LOGIN', mode: 'login', firebase: { apiKey: 'k', authDomain: 'cmn-dev.firebaseapp.com', projectId: 'cmn-dev', appId: 'a' }, projectLabel: 'cmn-dev' });
    assert.match(r.csp, /script-src 'self' https:\/\/apis\.google\.com;/);
    assert.match(r.csp, /connect-src 'self' https:\/\/identitytoolkit\.googleapis\.com https:\/\/securetoken\.googleapis\.com https:\/\/www\.googleapis\.com;/);
    assert.match(r.csp, /frame-src https:\/\/cmn-dev\.firebaseapp\.com https:\/\/apis\.google\.com;/);
    assert.doesNotMatch(r.csp, /127\.0\.0\.1|unsafe|\*/);
  } finally { await rp.close(); }
});
