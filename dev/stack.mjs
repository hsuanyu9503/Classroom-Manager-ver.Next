#!/usr/bin/env node
/** Runs inside `firebase emulators:exec` (started by dev/launcher.mjs). One scenario.
 *  Stops — always through the same path — when any of these happens (works on Linux, macOS and Windows):
 *   - the launcher creates the stop file (CMN_STOP_FILE): the launcher's normal stop request, no signal needed;
 *   - the launcher process is gone (CMN_LAUNCHER_PID): it was killed abruptly, so do not linger as an orphan;
 *   - SIGINT / SIGTERM / SIGBREAK (Ctrl+C or Ctrl+Break in the console reaches every process in it on Windows).
 *  The stop outcome (dev/stop.mjs) decides the exit code: 0 ONLY when the stop and the owned cleanup completed
 *  (or the emulators were confirmed already gone); a timeout or an error exits non-zero (WEB3-REV-001). The outcome is
 *  also written to CMN_STOP_RESULT so the launcher / tests can check it even when the launcher itself is gone.
 *  When this script ends, `firebase emulators:exec` shuts the emulators down itself. */
import { existsSync, writeFileSync } from 'node:fs';
import { openUpstream, startScenario, startLogin, LOGIN_SCENARIO } from './world.mjs';
import { runStop, STOP_TIMEOUT_MS, STOP_EXIT } from './stop.mjs';

const stage2 = process.env.CMN_UPSTREAM_STAGE2; const scenario = process.env.CMN_SCENARIO; const webPort = Number(process.env.CMN_WEB_PORT);
const stopFile = process.env.CMN_STOP_FILE || null;
const resultFile = process.env.CMN_STOP_RESULT || null;
const launcherPid = Number(process.env.CMN_LAUNCHER_PID) || null;
const up = await openUpstream(stage2);
const s = scenario === LOGIN_SCENARIO ? await startLogin(up, { webPort }) : await startScenario(up, { scenario, webPort });
console.log(`\nW1 ready — scenario ${scenario} (fictional data only)\nOpen: ${s.url}\nStop: Ctrl+C, or type q and Enter\n`);
if (s.identities) {
  console.log('Google sign-in (LOCAL Auth Emulator, fictional accounts — pick one in the sign-in window):');
  for (const [email, v] of Object.entries(s.identities)) console.log(`  ${email}  ${v.grant ? `→ bound to ${v.grant}` : '→ NO class access (no binding)'}`);
  console.log('');
}

const record = (r) => { if (resultFile) { try { writeFileSync(resultFile, JSON.stringify({ ...r, at: new Date().toISOString() })); } catch { /* reported by exit code */ } } };
let stopping = false;
const stop = async (why) => {
  if (stopping) return; stopping = true;
  console.log(`stack: stopping (${why})`);
  // last resort if even the outcome handling hangs: NOT a success
  setTimeout(() => { record({ trigger: why, outcome: 'STOP_TIMEOUT', code: STOP_EXIT.STOP_TIMEOUT, detail: 'hard limit' }); process.exit(STOP_EXIT.STOP_TIMEOUT); }, STOP_TIMEOUT_MS + 3000).unref();
  const r = await runStop({ stopStack: () => s.stop(), ownedCleanup: () => up.close(), emulatorsGone: () => up.emulatorsGone() });
  record({ trigger: why, ...r });
  console.log(r.code === 0 ? `stack: stop ${r.outcome}${r.detail ? ` — ${r.detail}` : ''}` : `stack: stop FAILED ${r.outcome} — ${r.detail}`);
  process.exit(r.code);
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) { try { process.on(sig, () => stop(sig)); } catch { /* signal not available here */ } }
setInterval(() => {
  if (stopFile && existsSync(stopFile)) stop('stop requested');
  else if (launcherPid && !alive(launcherPid)) stop('launcher gone');
}, 300).unref();
// keep the process alive until a stop trigger fires (stdin is not used: it may be closed, e.g. on Windows)
setInterval(() => {}, 1 << 30);
