/** WEB3-REV-001: a stop that times out or fails must NEVER be reported as a successful stop.
 *  1. runStop() unit cases;  2. the REAL dev/stack.mjs with an injected fault (mock world via a module hook,
 *  no emulator, no network), triggered the way an abrupt launcher exit triggers it (a launcher PID that is gone). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runStop, STOP_EXIT, STOP_TIMEOUT_MS } from '../dev/stop.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const never = () => new Promise(() => {});
const ok = async () => {};
const boom = async () => { throw new Error('boom'); };

describe('runStop()', () => {
  test('completed stop + completed cleanup → CLEAN, 0', async () => {
    assert.deepEqual(await runStop({ stopStack: ok, ownedCleanup: ok, emulatorsGone: async () => false }), { outcome: 'CLEAN', code: 0, detail: '' });
  });
  test('stack stop hangs → STOP_TIMEOUT, non-zero', async () => {
    const r = await runStop({ stopStack: never, ownedCleanup: ok, emulatorsGone: async () => true }, { timeoutMs: 200 });
    assert.equal(r.outcome, 'STOP_TIMEOUT'); assert.notEqual(r.code, 0);
  });
  test('owned cleanup hangs → STOP_TIMEOUT, non-zero', async () => {
    const r = await runStop({ stopStack: ok, ownedCleanup: never, emulatorsGone: async () => true }, { timeoutMs: 200 });
    assert.equal(r.outcome, 'STOP_TIMEOUT'); assert.notEqual(r.code, 0);
  });
  test('stack stop throws → STOP_ERROR, non-zero, cleanup not claimed', async () => {
    let cleaned = false;
    const r = await runStop({ stopStack: boom, ownedCleanup: async () => { cleaned = true; }, emulatorsGone: async () => true });
    assert.equal(r.outcome, 'STOP_ERROR'); assert.notEqual(r.code, 0); assert.equal(cleaned, false);
  });
  test('cleanup throws while the emulators still run → CLEANUP_ERROR, non-zero', async () => {
    const r = await runStop({ stopStack: ok, ownedCleanup: boom, emulatorsGone: async () => false });
    assert.equal(r.outcome, 'CLEANUP_ERROR'); assert.notEqual(r.code, 0);
  });
  test('cleanup throws and the emulator check itself fails or hangs → CLEANUP_ERROR (never assumed gone)', async () => {
    assert.equal((await runStop({ stopStack: ok, ownedCleanup: boom, emulatorsGone: boom })).outcome, 'CLEANUP_ERROR');
    assert.equal((await runStop({ stopStack: ok, ownedCleanup: boom, emulatorsGone: never })).outcome, 'CLEANUP_ERROR');
    assert.equal((await runStop({ stopStack: ok, ownedCleanup: boom, emulatorsGone: async () => 'yes' })).outcome, 'CLEANUP_ERROR', 'only true counts');
  });
  test('cleanup throws and the emulator ports are CONFIRMED closed → EMULATORS_GONE, 0 (explicitly classified)', async () => {
    const r = await runStop({ stopStack: ok, ownedCleanup: boom, emulatorsGone: async () => true });
    assert.equal(r.outcome, 'EMULATORS_GONE'); assert.equal(r.code, 0); assert.match(r.detail, /confirmed/);
  });
  test('exit codes: only CLEAN / EMULATORS_GONE are 0', () => {
    assert.deepEqual(Object.entries(STOP_EXIT).filter(([, c]) => c === 0).map(([k]) => k).sort(), ['CLEAN', 'EMULATORS_GONE']);
  });
});

/** a PID that existed and has exited */
const deadPid = () => { const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }); return Number(r.stdout); };
function runStack(mode) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cmn-w1-stoptest-'));
  const resultFile = path.join(dir, 'stop-result.json');
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--import', pathToFileURL(path.join(HERE, 'fixtures', 'register-mock-world.mjs')).href, path.join(HERE, '..', 'dev', 'stack.mjs')], {
      env: { ...process.env, MOCK_STOP: mode, CMN_SCENARIO: 'S-LEAVE-SC01', CMN_WEB_PORT: '0', CMN_LAUNCHER_PID: String(deadPid()), CMN_STOP_RESULT: resultFile, CMN_STOP_FILE: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => {
      let result = null; try { result = JSON.parse(readFileSync(resultFile, 'utf8')); } catch { /* none */ }
      rmSync(dir, { recursive: true, force: true });
      resolve({ code, out, result });
    });
  });
}

describe('dev/stack.mjs with an injected fault (abrupt-launcher trigger)', { concurrency: true }, () => {
  const fail = (mode, outcome) => test(`${mode} → exit ${STOP_EXIT[outcome]} (${outcome}), "stop FAILED", recorded`, { timeout: STOP_TIMEOUT_MS + 10000 }, async () => {
    const r = await runStack(mode);
    assert.equal(r.code, STOP_EXIT[outcome], r.out); assert.notEqual(r.code, 0);
    assert.match(r.out, /stack: stopping \(launcher gone\)/); assert.match(r.out, new RegExp(`stop FAILED ${outcome}`));
    assert.equal(r.result?.outcome, outcome); assert.equal(r.result?.trigger, 'launcher gone');
  });
  test('ok → exit 0, CLEAN, cleanup ran', async () => {
    const r = await runStack('ok');
    assert.equal(r.code, 0, r.out); assert.match(r.out, /MOCK cleanup done/); assert.match(r.out, /stack: stop CLEAN/); assert.equal(r.result?.outcome, 'CLEAN');
  });
  fail('hang-stop', 'STOP_TIMEOUT');
  fail('hang-cleanup', 'STOP_TIMEOUT');
  fail('throw-stop', 'STOP_ERROR');
  fail('throw-cleanup-running', 'CLEANUP_ERROR');
  test('throw-cleanup-gone → exit 0, EMULATORS_GONE (explicit, with the confirmation in the detail)', async () => {
    const r = await runStack('throw-cleanup-gone');
    assert.equal(r.code, 0, r.out); assert.equal(r.result?.outcome, 'EMULATORS_GONE'); assert.match(r.out, /stack: stop EMULATORS_GONE — .*confirmed/);
  });
});
