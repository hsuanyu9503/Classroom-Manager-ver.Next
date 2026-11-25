#!/usr/bin/env node
/** W1 development launcher (SPEC §3). Development machines only — not a feature of the page.
 *    node dev/launcher.mjs --upstream <class-management-next checkout> --scenario <S-ROSTER-A17|S-LEAVE-SC01|S-DENY>
 *  1. the upstream checkout must be at the pinned commit with a clean poc/stage2;
 *  2. every emulator / API / proxy port must be confirmed closed;
 *  3. `firebase emulators:exec` runs dev/stack.mjs: a fresh fictional world, the upstream stack, the web proxy;
 *  4. after it stops, the ports are confirmed closed again. Reset = stop and start again. */
import { spawn } from 'node:child_process';
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
  const env = cleanEnv(process.env, { RUN_NONCE: randomBytes(16).toString('hex'), CMN_UPSTREAM_STAGE2: u.stage2, CMN_SCENARIO: scenario, CMN_WEB_PORT: String(WEB_PORT) });
  // own process group: a stop signal reaches firebase, its shell, the stack and the emulators together (like Ctrl+C in a terminal)
  const child = spawn(process.execPath, [u.firebaseJs, 'emulators:exec', '--only', 'auth,firestore', '--project', PROJECT_ID, `node "${stackJs}"`], { cwd: u.stage2, env, stdio: 'inherit', detached: true });
  const forward = (sig) => { try { process.kill(-child.pid, sig); } catch { child.kill(sig); } };
  process.on('SIGINT', () => forward('SIGINT')); process.on('SIGTERM', () => forward('SIGTERM'));
  const code = await new Promise((r) => child.on('exit', (c) => r(c ?? 1)));
  // the stack may need a moment to notice its parent is gone; then every port must be confirmed closed
  let lastErr = null;
  for (let i = 0; i < 30; i += 1) { try { await requirePortsClosed(u.stage2, [...UPSTREAM_PORTS, WEB_PORT]); lastErr = null; break; } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 500)); } }
  if (lastErr) throw lastErr;
  console.log(`stopped (exit ${code}); ports confirmed closed`);
  process.exit(code);
} catch (e) {
  if (e instanceof UpstreamError) { console.log(`REFUSED: ${e.message}`); process.exit(2); }
  throw e;
}
