#!/usr/bin/env node
/** Launcher start / stop verification on THIS machine (Linux, macOS or Windows). Fictional data, local emulators only.
 *    node test/launcher-lifecycle.mjs --upstream <class-management-next checkout at the pinned commit>
 *  Cases (each starts the launcher fresh with S-LEAVE-SC01):
 *   A. normal stop: type "q" + Enter → exit 0, "ports confirmed closed", no force;
 *   B. launcher killed ABRUPTLY (no cleanup in the launcher itself) → the stack notices and every port closes;
 *   C. POSIX only: SIGINT to the launcher (what Ctrl+C does) → exit 0, no force.
 *      On Windows, Ctrl+C cannot be sent from a script: it is listed as MANUAL (see the printed instructions).
 *  In each case while running: GET / → 200, a path variant → 404 (SPEC §3). Afterwards every port is checked
 *  independently of the launcher's own report. Writes test-results/launcher-<platform>-<time>.json. */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkUpstream, requirePortsClosed, UPSTREAM_PORTS, WEB_PORT } from '../dev/upstream.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--upstream'); const upstream = i > 0 ? path.resolve(process.argv[i + 1]) : null;
if (!upstream) { console.log('usage: node test/launcher-lifecycle.mjs --upstream <path>'); process.exit(2); }
const u = checkUpstream(upstream);
const PORTS = [...UPSTREAM_PORTS, WEB_PORT];
const LAUNCHER = path.join(HERE, '..', 'dev', 'launcher.mjs');
const results = []; const log = (ok, name, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok === null ? 'MANUAL' : ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(method, target, headers = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: WEB_PORT, method, path: target, headers: { host: `127.0.0.1:${WEB_PORT}`, ...headers }, setHost: false }, (x) => { x.resume(); x.on('end', () => resolve(x.statusCode)); });
    r.on('error', () => resolve(0)); if (method === 'POST') r.write('{}'); r.end();
  });
}
async function portsClosedWithin(ms) {
  const t0 = Date.now(); let last = '';
  while (Date.now() - t0 < ms) { try { await requirePortsClosed(u.stage2, PORTS); return { ok: true, after: Date.now() - t0 }; } catch (e) { last = e.message; await sleep(500); } }
  return { ok: false, after: ms, last };
}
/** start the launcher; resolves once the stack prints "W1 ready" */
async function start() {
  await requirePortsClosed(u.stage2, PORTS);
  const p = spawn(process.execPath, [LAUNCHER, '--upstream', upstream, '--scenario', 'S-LEAVE-SC01'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  const exit = new Promise((r) => p.on('exit', (c, sig) => r({ code: c, sig })));
  const t0 = Date.now();
  while (!out.includes('W1 ready') && Date.now() - t0 < 180000) { if (p.exitCode !== null) break; await sleep(300); }
  if (!out.includes('W1 ready')) throw new Error(`launcher not ready:\n${out.slice(-3000)}`);
  const index = await req('GET', '/');
  const variant = await req('POST', '/extra/../v1/read', { origin: `http://127.0.0.1:${WEB_PORT}`, 'content-type': 'application/json' });
  return { p, exit, out: () => out, index, variant, readyAfter: Date.now() - t0 };
}
const withTimeout = (pr, ms) => Promise.race([pr, sleep(ms).then(() => null)]);

console.log(`platform ${process.platform} ${os.release()} — node ${process.version}`);
try {
  /* A: q + Enter */
  {
    const s = await start();
    s.p.stdin.write('q\n');
    const e = await withTimeout(s.exit, 90000);
    const ports = await portsClosedWithin(30000);
    const out = s.out();
    log(s.index === 200 && s.variant === 404 && e && e.code === 0 && /stopped \(exit 0\); ports confirmed closed/.test(out) && !/FORCE/.test(out) && ports.ok,
      'A: "q" + Enter → graceful stop, exit 0, no force, every port closed', `index=${s.index} variant=${s.variant} ready=${s.readyAfter}ms exit=${JSON.stringify(e)} ports=${JSON.stringify(ports)}`);
  }
  /* B: abrupt kill of the launcher (POSIX SIGKILL; Windows TerminateProcess) */
  {
    const s = await start();
    if (process.platform === 'win32') s.p.kill(); else s.p.kill('SIGKILL');
    const e = await withTimeout(s.exit, 10000);
    const ports = await portsClosedWithin(90000);
    log(s.index === 200 && s.variant === 404 && e !== null && ports.ok,
      'B: launcher killed abruptly → the stack stops by itself; every port closed (no orphan listening)', `index=${s.index} variant=${s.variant} exit=${JSON.stringify(e)} ports=${JSON.stringify(ports)}`);
  }
  /* C: Ctrl+C */
  if (process.platform !== 'win32') {
    const s = await start();
    s.p.kill('SIGINT');
    const e = await withTimeout(s.exit, 90000);
    const ports = await portsClosedWithin(30000);
    const out = s.out();
    log(s.index === 200 && s.variant === 404 && e && e.code === 0 && /stopped \(exit 0\)/.test(out) && !/FORCE/.test(out) && ports.ok,
      'C: SIGINT to the launcher (Ctrl+C) → graceful stop, exit 0, no force, every port closed', `exit=${JSON.stringify(e)} ports=${JSON.stringify(ports)}`);
  } else {
    log(null, 'C: Ctrl+C on Windows cannot be sent from a script — check by hand',
      'run `node dev\\launcher.mjs --upstream <path> --scenario S-LEAVE-SC01` in a terminal, open http://127.0.0.1:18400/, press Ctrl+C: expect "stopped (exit 0); ports confirmed closed" (not FORCE)');
  }
} catch (e) {
  log(false, 'lifecycle aborted', String(e.stack || e).split('\n').slice(0, 6).join(' | '));
}
const final = await portsClosedWithin(5000);
log(final.ok, 'final: every port closed after all cases', JSON.stringify(final));
const auto = results.filter((r) => r.ok !== null);
const ok = auto.every((r) => r.ok);
const out = path.join(HERE, '..', 'test-results', `launcher-${process.platform}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}.json`);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ platform: process.platform, release: os.release(), node: process.version, ok, results }, null, 2));
console.log(`LAUNCHER_LIFECYCLE ok=${ok} checks=${auto.filter((r) => r.ok).length}/${auto.length} out=${out}`);
process.exit(ok ? 0 : 1);
