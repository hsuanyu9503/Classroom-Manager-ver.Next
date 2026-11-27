#!/usr/bin/env node
/** W1 E2E orchestrator: same checks as the launcher (pinned upstream, clean, ports closed), then
 *  `firebase emulators:exec` runs test/e2e.mjs; ports confirmed closed afterwards.
 *    node test/run-e2e.mjs --upstream <class-management-next checkout at the pinned commit> [--script e2e|screens]
 *  --script screens runs test/screens.mjs (acceptance screenshots) instead of test/e2e.mjs. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkUpstream, requirePortsClosed, importUpstream, UPSTREAM_PORTS, WEB_PORT, PINNED_COMMIT, UpstreamError } from '../dev/upstream.mjs';

const i = process.argv.indexOf('--upstream'); const upstream = i > 0 ? path.resolve(process.argv[i + 1]) : null;
const si = process.argv.indexOf('--script'); const script = si > 0 ? process.argv[si + 1] : 'e2e';
if (!upstream || !['e2e', 'screens'].includes(script)) { console.log('usage: node test/run-e2e.mjs --upstream <path> [--script e2e|screens]'); process.exit(2); }
const PORTS = [...UPSTREAM_PORTS, WEB_PORT, 18401, 18402];
try {
  const u = checkUpstream(upstream);
  await requirePortsClosed(u.stage2, PORTS);
  const { cleanEnv } = await importUpstream(u.stage2, 'src/orchestrator.mjs');
  const { PROJECT_ID } = await importUpstream(u.stage2, 'src/local-guard.mjs');
  const e2e = path.join(path.dirname(fileURLToPath(import.meta.url)), `${script}.mjs`);
  const env = cleanEnv(process.env, { RUN_NONCE: randomBytes(16).toString('hex'), CMN_UPSTREAM_STAGE2: u.stage2, CMN_UPSTREAM_COMMIT: PINNED_COMMIT, ...(process.env.W1_OUT ? { W1_OUT: process.env.W1_OUT } : {}) });
  const r = spawnSync(process.execPath, [u.firebaseJs, 'emulators:exec', '--only', 'auth,firestore', '--project', PROJECT_ID, `node "${e2e}"`], { cwd: u.stage2, env, encoding: 'utf8', timeout: 1500000, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out.split('\n').filter((l) => /^(OK|FAIL|W1_E2E|Error|OWNERSHIP|LOCAL_GUARD)/.test(l.trim())).join('\n') + '\n');
  if (r.status !== 0) console.log(out.slice(-4000));
  await requirePortsClosed(u.stage2, PORTS);
  console.log(`E2E exit ${r.status}; ports confirmed closed`);
  process.exit(r.status === 0 ? 0 : 1);
} catch (e) {
  if (e instanceof UpstreamError) { console.log(`REFUSED: ${e.message}`); process.exit(2); }
  throw e;
}
