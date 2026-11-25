#!/usr/bin/env node
/** Runs inside `firebase emulators:exec` (started by dev/launcher.mjs). One scenario; stops on SIGINT / SIGTERM or
 *  when stdin closes. */
import { openUpstream, startScenario } from './world.mjs';

const stage2 = process.env.CMN_UPSTREAM_STAGE2; const scenario = process.env.CMN_SCENARIO; const webPort = Number(process.env.CMN_WEB_PORT);
const up = await openUpstream(stage2);
const s = await startScenario(up, { scenario, webPort });
console.log(`\nW1 ready — scenario ${scenario} (fictional data only)\nOpen: ${s.url}\nStop: Ctrl+C\n`);
let stopping = false;
/** orphaned = the emulators are already gone: skip the owned cleanup (it would only time out). Never hang: hard exit after 3 s. */
const stop = async (orphaned = false) => {
  if (stopping) return; stopping = true;
  setTimeout(() => process.exit(0), 3000).unref();
  try { await s.stop(); if (!orphaned) await up.close(); } finally { process.exit(0); }
};
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
process.stdin.on('end', () => stop()); process.stdin.resume();
// if the emulators:exec parent goes away (e.g. only the launcher was signalled), do not linger as an orphan
const parent = process.ppid;
setInterval(() => { if (process.ppid !== parent) stop(true); }, 500).unref();
