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
