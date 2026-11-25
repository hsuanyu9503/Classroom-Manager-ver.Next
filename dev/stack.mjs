#!/usr/bin/env node
/** Runs inside `firebase emulators:exec` (started by dev/launcher.mjs). One scenario.
 *  Stops — always through the same graceful path — when any of these happens (works on Linux, macOS and Windows):
 *   - the launcher creates the stop file (CMN_STOP_FILE): the launcher's normal stop request, no signal needed;
 *   - the launcher process is gone (CMN_LAUNCHER_PID): it was killed abruptly, so do not linger as an orphan;
 *   - SIGINT / SIGTERM / SIGBREAK (Ctrl+C or Ctrl+Break in the console reaches every process in it on Windows).
 *  When this script ends, `firebase emulators:exec` shuts the emulators down itself. */
import { existsSync } from 'node:fs';
import { openUpstream, startScenario } from './world.mjs';

const stage2 = process.env.CMN_UPSTREAM_STAGE2; const scenario = process.env.CMN_SCENARIO; const webPort = Number(process.env.CMN_WEB_PORT);
const stopFile = process.env.CMN_STOP_FILE || null;
const launcherPid = Number(process.env.CMN_LAUNCHER_PID) || null;
const up = await openUpstream(stage2);
const s = await startScenario(up, { scenario, webPort });
console.log(`\nW1 ready — scenario ${scenario} (fictional data only)\nOpen: ${s.url}\nStop: Ctrl+C, or type q and Enter\n`);
let stopping = false;
/** Never hang: hard exit after 5 s. */
const stop = async (why) => {
  if (stopping) return; stopping = true;
  console.log(`stack: stopping (${why})`);
  setTimeout(() => process.exit(0), 5000).unref();
  try { await s.stop(); await up.close(); } catch { /* the emulators may already be going away */ } finally { process.exit(0); }
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) { try { process.on(sig, () => stop(sig)); } catch { /* signal not available here */ } }
setInterval(() => {
  if (stopFile && existsSync(stopFile)) stop('stop requested');
  else if (launcherPid && !alive(launcherPid)) stop('launcher gone');
}, 300).unref();
// keep the process alive until a stop trigger fires (stdin is not used: it may be closed, e.g. on Windows)
setInterval(() => {}, 1 << 30);
