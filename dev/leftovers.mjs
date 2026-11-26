#!/usr/bin/env node
/** Leftover check for the W1 ports (WEB3-REV-002). Development use only.
 *    node dev/leftovers.mjs --upstream <class-management-next checkout>                      list, never stops anything
 *    node dev/leftovers.mjs --upstream <path> --stop <PID> --started <START>                 stop ONE owned process
 *
 *  A listener is OWNED (= started by this W1 setup) only when its full command line proves it:
 *   - Firestore emulator: java + the cloud-firestore-emulator JAR + `--project_id <the demo project>` + `--rules` with
 *     THIS upstream checkout's poc/stage2/firestore.rules;
 *   - firebase: THIS upstream checkout's firebase-tools + `emulators:exec` + the demo project;
 *   - stack: THIS website checkout's dev/stack.mjs.
 *  A process name or a port alone is NEVER enough. Anything else is NOT_OWNED and is never stopped: report it.
 *  --stop re-reads everything just before stopping and requires the same PID, the same start time (--started, as
 *  printed by the list), still listening on a W1 port and still OWNED; otherwise it refuses and stops nothing.
 *  Supported: Windows (PowerShell) and Linux (/proc). */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkUpstream, importUpstream, UPSTREAM_PORTS, WEB_PORT } from './upstream.mjs';

export const W1_PORTS = Object.freeze([...UPSTREAM_PORTS, WEB_PORT]);
const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** case-insensitive on Windows, forward slashes, no trailing separator */
export const norm = (p, win) => { const s = String(p).replace(/\\/g, '/').replace(/\/+$/, ''); return win ? s.toLowerCase() : s; };

/** split a command line into arguments (double quotes group; enough for the processes we look at) */
export const args = (cmd) => [...String(cmd).matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
/** the value right after an exact flag, or null */
const valueOf = (a, flag) => { const i = a.indexOf(flag); return i >= 0 && i + 1 < a.length ? a[i + 1] : null; };

/** → { verdict: 'OWNED' | 'NOT_OWNED', role, reason } — pure, unit-tested. Exact argument matching, no substrings. */
export function classify({ name, cmd }, { stage2, siteRoot, projectId, win }) {
  if (!cmd) return { verdict: 'NOT_OWNED', role: null, reason: 'command line not readable' };
  const a = args(cmd); const N = (x) => norm(x, win); const n = String(name || '').toLowerCase().replace(/\.exe$/, '');
  const exe = N(a[0] || '').split('/').pop().replace(/\.exe$/, '');
  if (n === 'java' && exe === 'java') {
    const jar = valueOf(a, '-jar');
    const ok = jar && /^cloud-firestore-emulator-v[\d.]+\.jar$/.test(N(jar).split('/').pop())
      && valueOf(a, '--project_id') === projectId && valueOf(a, '--rules') !== null && N(valueOf(a, '--rules')) === `${N(stage2)}/firestore.rules`;
    return ok ? { verdict: 'OWNED', role: 'firestore-emulator', reason: 'Firestore emulator JAR, demo project, rules of this upstream checkout' }
      : { verdict: 'NOT_OWNED', role: null, reason: 'java, but not the Firestore emulator of this upstream checkout' };
  }
  if (n === 'node' && exe === 'node') {
    if (a[1] && N(a[1]) === `${N(stage2)}/node_modules/firebase-tools/lib/bin/firebase.js` && a[2] === 'emulators:exec' && valueOf(a, '--project') === projectId) return { verdict: 'OWNED', role: 'firebase', reason: 'firebase-tools of this upstream checkout, emulators:exec, demo project' };
    if (a[1] && N(a[1]) === `${N(siteRoot)}/dev/stack.mjs` && a.length === 2) return { verdict: 'OWNED', role: 'stack', reason: 'dev/stack.mjs of this website checkout' };
    return { verdict: 'NOT_OWNED', role: null, reason: 'node, but not this W1 setup' };
  }
  return { verdict: 'NOT_OWNED', role: null, reason: `process "${name}" is not part of this W1 setup` };
}

/** → [{ port, pid, name, started, cmd }] for every listener on a W1 port */
export function listeners() {
  if (process.platform === 'win32') {
    const ps = `$ports=@(${W1_PORTS.join(',')}); $r=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort } | ForEach-Object { $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"; [pscustomobject]@{ port=[int]$_.LocalPort; pid=[int]$_.OwningProcess; name=$(if($p){$p.Name}else{$null}); started=$(if($p -and $p.CreationDate){$p.CreationDate.ToUniversalTime().ToString('o')}else{$null}); cmd=$(if($p){$p.CommandLine}else{$null}) } }); ConvertTo-Json -InputObject $r -Compress -Depth 3`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true }).trim();
    const v = out ? JSON.parse(out) : []; return Array.isArray(v) ? v : [v];
  }
  if (process.platform === 'linux') {
    // /proc only (no external tool): LISTEN sockets (state 0A) on W1 ports → socket inodes → owning PIDs
    const inodes = new Map();
    for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
      let t = ''; try { t = readFileSync(f, 'utf8'); } catch { continue; }
      for (const line of t.split('\n').slice(1)) {
        const c = line.trim().split(/\s+/); if (c.length < 10 || c[3] !== '0A') continue;
        const port = parseInt(c[1].split(':')[1], 16); if (W1_PORTS.includes(port)) inodes.set(c[9], port);
      }
    }
    const rows = [];
    if (!inodes.size) return rows;
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      let fds = []; try { fds = readdirSync(`/proc/${d}/fd`); } catch { continue; }
      for (const fd of fds) {
        let l = ''; try { l = readlinkSync(`/proc/${d}/fd/${fd}`); } catch { continue; }
        const m = l.match(/^socket:\[(\d+)\]$/); if (!m || !inodes.has(m[1])) continue;
        const pid = Number(d); const port = inodes.get(m[1]);
        if (rows.some((r) => r.port === port && r.pid === pid)) continue;
        let cmd = null; let name = null; let started = null;
        try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' '); } catch { /* gone */ }
        try { name = readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { /* gone */ }
        try { started = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19]; } catch { /* gone */ }   // start time in clock ticks since boot
        rows.push({ port, pid, name, started: started ? `boot+${started}` : null, cmd });
      }
    }
    return rows;
  }
  throw new Error(`leftover check is not supported on ${process.platform}`);
}

async function main() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const upstream = arg('--upstream') ? path.resolve(arg('--upstream')) : null;
  if (!upstream) { console.log('usage: node dev/leftovers.mjs --upstream <path> [--stop <PID> --started <START>]'); process.exit(2); }
  const u = checkUpstream(upstream);
  const { PROJECT_ID } = await importUpstream(u.stage2, 'src/local-guard.mjs');
  const ctx = { stage2: u.stage2, siteRoot: SITE_ROOT, projectId: PROJECT_ID, win: process.platform === 'win32' };
  const rows = listeners().map((r) => ({ ...r, ...classify(r, ctx) }));
  const stopPid = arg('--stop');
  if (!stopPid) {
    if (!rows.length) { console.log('LEFTOVERS none — no process is listening on the W1 ports'); return 0; }
    for (const r of rows) {
      console.log(`${r.verdict.padEnd(9)} port ${r.port}  PID ${r.pid}  ${r.name}  started ${r.started}\n          ${r.reason}\n          command: ${r.cmd}`);
    }
    const owned = [...new Map(rows.filter((r) => r.verdict === 'OWNED').map((r) => [r.pid, r])).values()];
    for (const r of owned) console.log(`\nto stop PID ${r.pid} (${r.role}):\n  node dev/leftovers.mjs --upstream "${upstream}" --stop ${r.pid} --started "${r.started}"`);
    if (rows.some((r) => r.verdict === 'NOT_OWNED')) console.log('\nNOT_OWNED: do not stop these. They are not part of this W1 setup (or cannot be confirmed); report them instead.');
    return rows.some((r) => r.verdict === 'NOT_OWNED') ? 3 : 1;
  }
  // --stop: re-check everything right now
  const pid = Number(stopPid); const started = arg('--started');
  const mine = rows.filter((r) => r.pid === pid);
  const refuse = (why) => { console.log(`REFUSED: ${why}. Nothing was stopped.`); return 2; };
  if (!Number.isInteger(pid) || pid <= 0) return refuse('--stop needs a PID');
  if (!started) return refuse('--started is required (copy it from the list)');
  if (!mine.length) return refuse(`PID ${pid} is not listening on a W1 port now`);
  if (mine.some((r) => r.started !== started)) return refuse(`PID ${pid} has start time ${mine[0].started}, not ${started} (a different process may now have this PID)`);
  if (mine.some((r) => r.verdict !== 'OWNED')) return refuse(`PID ${pid} is NOT_OWNED: ${mine.find((r) => r.verdict !== 'OWNED').reason}`);
  process.kill(pid);
  console.log(`stopped PID ${pid} (${mine[0].role}, ports ${mine.map((r) => r.port).join(', ')})`);
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (!listeners().some((r) => r.pid === pid)) { console.log('confirmed: it no longer listens on any W1 port'); return 0; }
  }
  console.log(`WARNING: PID ${pid} still listens after 10 s; report this`);
  return 4;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
