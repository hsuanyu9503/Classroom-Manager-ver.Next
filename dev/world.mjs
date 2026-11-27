/** Inside `firebase emulators:exec` only: builds ONE fresh fictional world with the upstream harness, starts the
 *  upstream back proxy → controlled API → front proxy, and the web proxy holding only the scenario actor's token
 *  (SPEC §3). Owner access, passwords and the other actors' tokens stay inside the harness and never reach the proxy
 *  or the page. */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
/** Firestore and Auth emulator ports, as in the upstream poc/stage2/firebase.json (also in UPSTREAM_PORTS). */
export const EMULATOR_PORTS = Object.freeze([8080, 9099]);
export const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
export const STATIC_FILES = Object.freeze({ '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/tokens.css': 'tokens.css', '/app.js': 'app.js', '/vendor/firebase-auth.js': 'vendor/firebase-auth.js' });
/** Google sign-in against the LOCAL Auth Emulator (not a test actor). See dev/login-identities.json. */
export const LOGIN_SCENARIO = 'LOGIN';
const LOGIN_IDENTITIES = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'login-identities.json'), 'utf8')).identities;

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
  const { portState } = await U('src/port-state.mjs');
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
    /** true only if the Firestore and Auth emulator ports (upstream firebase.json) are confirmed closed */
    emulatorsGone: async () => { for (const p of EMULATOR_PORTS) { if ((await portState(p)).state !== 'closed') return false; } return true; },
  };
}

/** Creates a Google-provider account in the LOCAL Auth Emulator for a fictional identity (signInWithIdp with an
 *  emulator-only fake Google credential) → its uid. The account then appears in the emulator's sign-in popup. */
async function createEmulatorGoogleAccount(authOrigin, projectId, { email, name }) {
  const url = `${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=emulator-local`;
  const u = new URL(url); if (u.hostname !== '127.0.0.1') throw new Error('login: auth emulator must be loopback');
  const idToken = JSON.stringify({ sub: `fictional-${email}`, email, email_verified: true, name });
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`, requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true }) });
  const j = await r.json().catch(() => null);
  if (r.status !== 200 || !j?.localId) throw new Error(`login: could not create the emulator Google account for ${email} (${r.status})`);
  if (j.projectId && j.projectId !== projectId) throw new Error('login: wrong emulator project');
  return j.localId;
}

/** LOGIN mode: a fresh fictional world + the fictional Google identities; bindings ONLY for configured grants.
 *  The web proxy holds no token. → { url, identities: { email: { uid, grant } }, users, stack, proxy, traceDir, stop } */
export async function startLogin(up, { webPort, upstreamOverride = null }) {
  const users = await up.h.seedWorld();
  const authOrigin = up.cfg.auth.origin;
  const identities = {};
  for (const id of LOGIN_IDENTITIES) {
    if (!/@example\.test$/.test(id.email)) throw new Error('login: identities must use the reserved example.test domain');
    const uid = await createEmulatorGoogleAccount(authOrigin, up.cfg.projectId, id);
    if (id.grant !== null) {
      if (!Object.values(SCENARIOS).includes(id.grant)) throw new Error(`login: unknown principal ${id.grant}`);
      // explicit, configured grant: bind this Google uid to an EXISTING fictional principal (no new rights are created)
      await up.h.putDoc(`authBindings/${uid}`, { authUid: uid, principalId: id.grant, status: 'active', activatedAt: new Date(Date.now() - 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'), bindingVersion: 1 });
    }
    identities[id.email] = { uid, grant: id.grant };
  }
  const traceDir = mkdtempSync(path.join(os.tmpdir(), 'cmn-w1-'));
  const stack = await up.h.startStack({ frontFile: path.join(traceDir, 'trace-front.jsonl'), backFile: path.join(traceDir, 'trace-back.jsonl') });
  const proxy = createWebProxy({ port: webPort, upstream: upstreamOverride || `http://127.0.0.1:${up.PORTS.front}`, scenario: LOGIN_SCENARIO, webRoot: WEB_ROOT, staticFiles: STATIC_FILES,
    login: { authOrigin, firebase: { apiKey: 'demo-api-key', projectId: up.cfg.projectId, authDomain: `${up.cfg.projectId}.firebaseapp.com` },
      // the fictional accounts the emulator sign-in chooser offers (names + emails only; NO grant information)
      emulatorAccounts: LOGIN_IDENTITIES.map(({ email, name }) => ({ email, name })) } });
  const port = await proxy.listen();
  return {
    url: `http://127.0.0.1:${port}/`, identities, users, stack, proxy, traceDir,
    stop: async () => { await proxy.close(); await stack.stop(); rmSync(traceDir, { recursive: true, force: true }); },
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
