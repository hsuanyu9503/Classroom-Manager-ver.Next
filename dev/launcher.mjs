#!/usr/bin/env node
/** W1 development launcher (SPEC §3). Development machines only — not a feature of the page.
 *    node dev/launcher.mjs --upstream <class-management-next checkout> --scenario <S-ROSTER-A17|S-LEAVE-SC01|S-DENY>
 *  1. the upstream checkout must be at the pinned commit with a clean poc/stage2;
 *  2. every emulator / API / proxy port must be confirmed closed;
 *  3. `firebase emulators:exec` runs dev/stack.mjs: a fresh fictional world, the upstream stack, the web proxy;
 *  4. after it stops, the ports are confirmed closed again. Reset = stop and start again.
 *  Stopping (Linux, macOS, Windows): Ctrl+C, Ctrl+Break, SIGTERM, or typing q + Enter. The launcher first asks the
 *  stack to stop through a STOP FILE (no signal needed, so it also works on Windows, which has no POSIX process
 *  groups). The stack also stops by itself if the launcher is killed abruptly (it watches the launcher's PID).
 *  If the stack does not end in time, the launcher escalates: POSIX → SIGINT, then SIGKILL to the whole process
 *  group; Windows → `taskkill /T /F` on the process tree. A forced stop is reported and exits 3.
 *  firebase is started DETACHED on every platform. On Windows this keeps it out of the launcher's kill-on-close job
 *  object (libuv), so an abrupt end of the launcher does not kill firebase before it can stop the Java Firestore
 *  emulator, which firebase-tools itself starts detached (Windows run 2026-11-26: 8080/9150 were left open).
 *  Its output goes to a LOG FILE that the launcher relays to the screen, never to a pipe: once the launcher is gone,
 *  a write to a broken pipe could end firebase before its cleanup.
 *  Success (exit 0) requires ALL of: the stack recorded a successful stop outcome (dev/stop.mjs), firebase exited 0,
 *  no escalation was needed, and every port is confirmed closed. Anything else is reported as a failure (WEB3-REV-001). */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, openSync, closeSync, readSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkUpstream, requirePortsClosed, importUpstream, UPSTREAM_PORTS, WEB_PORT, UpstreamError } from './upstream.mjs';
import { SCENARIOS } from './world.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const scenario = arg('--scenario'); const upstream = arg('--upstream') ? path.resolve(arg('--upstream')) : null;
if (!Object.hasOwn(SCENARIOS, scenario || '') || !upstream) { console.log(`usage: node dev/launcher.mjs --upstream <path> --scenario <${Object.keys(SCENARIOS).join('|')}>`); process.exit(2); }
try {
  const u = checkUpstream(upstream);
  await requirePortsClosed(u.stage2, [...UPSTREAM_PORTS, WEB_PORT]);
  const { cleanEnv } = await importUpstream(u.stage2, 'src/orchestrator.mjs');
  const { PROJECT_ID } = await importUpstream(u.stage2, 'src/local-guard.mjs');
  const stackJs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stack.mjs');
  const ctl = mkdtempSync(path.join(os.tmpdir(), 'cmn-w1-ctl-')); const stopFile = path.join(ctl, 'stop'); const resultFile = path.join(ctl, 'stop-result.json');
  console.log(`launcher: control dir ${ctl}`);
  const env = cleanEnv(process.env, { RUN_NONCE: randomBytes(16).toString('hex'), CMN_UPSTREAM_STAGE2: u.stage2, CMN_SCENARIO: scenario, CMN_WEB_PORT: String(WEB_PORT), CMN_STOP_FILE: stopFile, CMN_STOP_RESULT: resultFile, CMN_LAUNCHER_PID: String(process.pid) });
  const win = process.platform === 'win32';
  // POSIX: own process group, so an escalation reaches firebase, its shell, the stack and the emulators together
  const logFile = path.join(ctl, 'emulators.log'); const logFd = openSync(logFile, 'a');
  const child = spawn(process.execPath, [u.firebaseJs, 'emulators:exec', '--only', 'auth,firestore', '--project', PROJECT_ID, `node "${stackJs}"`], { cwd: u.stage2, env, stdio: ['ignore', logFd, logFd], detached: true, windowsHide: true });
  closeSync(logFd);
  // relay the log file to this console (also lets a test read "W1 ready" from the launcher's stdout)
  const rfd = openSync(logFile, 'r'); let pos = 0; const buf = Buffer.alloc(64 * 1024);
  const relay = () => { for (;;) { const n = readSync(rfd, buf, 0, buf.length, pos); if (n <= 0) break; pos += n; process.stdout.write(buf.subarray(0, n)); } };
  const relayTimer = setInterval(relay, 200);
  let exited = false; let forced = null; let requested = false;
  const exitP = new Promise((r) => child.on('exit', (c) => { exited = true; r(c ?? 1); }));
  const group = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } } };
  const requestStop = (why) => {
    if (requested) return; requested = true;
    console.log(`launcher: stop requested (${why})`);
    try { writeFileSync(stopFile, why); } catch { /* the escalation below still applies */ }
    setTimeout(() => { if (!exited) { forced = 'interrupt'; if (!win) group('SIGINT'); } }, 20000).unref();
    setTimeout(() => {
      if (exited) return; forced = 'kill';
      if (win) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else group('SIGKILL');
    }, 40000).unref();
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) { try { process.on(sig, () => requestStop(sig)); } catch { /* not available */ } }
  // typing q + Enter also stops (stdin closing does NOT stop: it may be closed from the start)
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { if (/^\s*q\s*$/im.test(d)) requestStop('q'); });
  process.stdin.on('error', () => {});
  const code = await exitP;
  clearInterval(relayTimer); relay(); closeSync(rfd);
  process.stdin.pause(); process.stdin.unref?.();
  let stopResult = null; try { stopResult = JSON.parse(readFileSync(resultFile, 'utf8')); } catch { /* missing = not a success */ }
  rmSync(ctl, { recursive: true, force: true });
  // the emulators may need a moment to release their ports; then every port must be confirmed closed
  let lastErr = null;
  for (let i = 0; i < 60; i += 1) { try { await requirePortsClosed(u.stage2, [...UPSTREAM_PORTS, WEB_PORT]); lastErr = null; break; } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 500)); } }
  if (lastErr) throw lastErr;
  if (forced) { console.log(`stopped by FORCE (${forced}; exit ${code}); ports confirmed closed — NOT a clean stop`); process.exit(3); }
  const stackOk = stopResult && stopResult.code === 0;
  if (!stackOk || code !== 0) {
    const what = stopResult ? `${stopResult.outcome}${stopResult.detail ? ` — ${stopResult.detail}` : ''}` : 'no stop outcome recorded by the stack';
    console.log(`stop FAILED (exit ${code}; stack: ${what}); ports confirmed closed`);
    process.exit(code !== 0 ? code : (stopResult?.code || 5));
  }
  console.log(`stopped (exit 0); ports confirmed closed; stack cleanup: ${stopResult.outcome}`);
  process.exit(0);
} catch (e) {
  if (e instanceof UpstreamError) { console.log(`REFUSED: ${e.message}`); process.exit(2); }
  throw e;
}
