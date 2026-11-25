/** Inside `firebase emulators:exec` only: builds ONE fresh fictional world with the upstream harness, starts the
 *  upstream back proxy → controlled API → front proxy, and the web proxy holding only the scenario actor's token
 *  (SPEC §3). Owner access, passwords and the other actors' tokens stay inside the harness and never reach the proxy
 *  or the page. */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importUpstream } from './upstream.mjs';
import { createWebProxy } from './proxy.mjs';

export const SCENARIOS = Object.freeze({
  'S-ROSTER-A17': 'ACTOR-TEACHER',
  'S-LEAVE-SC01': 'ACTOR-SC01-TEACHER',
  'S-DENY': 'ACTOR-OTHER',
});
export const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
export const STATIC_FILES = Object.freeze({ '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/tokens.css': 'tokens.css', '/app.js': 'app.js' });

/** Ownership + harness, created once per emulators:exec run. */
export async function openUpstream(stage2) {
  const U = (rel) => importUpstream(stage2, rel);
  const { assertLocalConfig } = await U('src/local-guard.mjs');
  const { firestoreClient, authClient, EMULATOR_OWNER } = await U('src/emu-client.mjs');
  const { MARKER_COLLECTION, assertNonce, assertFreshEmulator, assertStillOwned } = await U('src/ownership.mjs');
  const { loadFixtures } = await U('src/seed.mjs');
  const { makeMasker } = await U('src/mask.mjs');
  const { fixtureNames } = await U('src/world.mjs');
  const { createHarness, PORTS } = await U('src/harness.mjs');
  const cfg = assertLocalConfig(process.env, { firebaseJsonPath: path.join(stage2, 'firebase.json') });
  const nonce = assertNonce(process.env.RUN_NONCE);
  const fsc = firestoreClient(cfg); const au = authClient(cfg);
  const rc = await fsc.listRootCollections(EMULATOR_OWNER); const ac = await au.countAccounts();
  assertFreshEmulator({ rootCollections: rc.status === 200 ? (rc.json?.collectionIds || []) : null, authAccounts: ac.status === 200 ? Number(ac.json?.recordsCount ?? 0) : null });
  if ((await fsc.set(`${MARKER_COLLECTION}/${nonce}`, { nonce, createdAt: new Date().toISOString() }, EMULATOR_OWNER)).status !== 200) throw new Error('ownership marker');
  const { fixtures } = loadFixtures();
  const names = fixtureNames(fixtures);
  const masker = makeMasker(names);
  const h = createHarness({ cfg, nonce, fixtures, masker });
  return {
    h, cfg, PORTS, names, fixtures,
    /** owned cleanup at the end of the run */
    close: async () => { assertStillOwned(await h.markerIds(), nonce); await fsc.clearAll(); await au.clearAll(); },
  };
}

/** A fresh world for one scenario. `upstreamOverride` is for the E2E fault proxy only (never used by the launcher).
 *  → { url, users, stack, proxy, traceDir, stop } */
export async function startScenario(up, { scenario, webPort, upstreamOverride = null }) {
  if (!Object.hasOwn(SCENARIOS, scenario)) throw new Error(`unknown scenario ${scenario}`);
  const users = await up.h.seedWorld();
  const traceDir = mkdtempSync(path.join(os.tmpdir(), 'cmn-w1-'));
  const stack = await up.h.startStack({ frontFile: path.join(traceDir, 'trace-front.jsonl'), backFile: path.join(traceDir, 'trace-back.jsonl') });
  const token = users[SCENARIOS[scenario]].token;
  const proxy = createWebProxy({ port: webPort, upstream: upstreamOverride || `http://127.0.0.1:${up.PORTS.front}`, token, scenario, webRoot: WEB_ROOT, staticFiles: STATIC_FILES });
  const port = await proxy.listen();
  return {
    url: `http://127.0.0.1:${port}/`, users, stack, proxy, traceDir,
    stop: async () => { await proxy.close(); await stack.stop(); rmSync(traceDir, { recursive: true, force: true }); },
  };
}
