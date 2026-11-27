/** Server layer (SPEC §12): mode guards, credentials, REAL-project ID token verification, URL allow-list, and
 *  that the vendored upstream business logic is byte-identical to class-management-next 1e20989. No network:
 *  Google is never contacted; tokens are minted with a throw-away test key (openssl). */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, createSign, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig, ConfigError } from '../server/config.mjs';
import { createAccessTokenSource } from '../server/credentials.mjs';
import { checkFirebaseTokenClaims, verifyFirebaseIdToken, createCertCache } from '../server/token-firebase.mjs';
import { createFirebaseBackend, GOOGLE_ENDPOINTS } from '../server/backend.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = 'cmn-dev-test';
const REAL = { CMN_API_MODE: 'firebase', CMN_FIREBASE_PROJECT_ID: P, CMN_CONFIRM_FIREBASE_PROJECT: P, CMN_GCP_CREDENTIALS: 'adc' };

describe('mode guards (server/config.mjs)', () => {
  test('firebase mode: explicit project, confirmed twice, credentials named', () => {
    assert.deepEqual(resolveConfig(REAL), { mode: 'firebase', projectId: P, credentials: 'adc' });
  });
  for (const [why, env] of [
    ['no mode', { ...REAL, CMN_API_MODE: '' }],
    ['unknown mode', { ...REAL, CMN_API_MODE: 'prod' }],
    ['confirmation differs (wrong project)', { ...REAL, CMN_CONFIRM_FIREBASE_PROJECT: 'cmn-other' }],
    ['no confirmation', { ...REAL, CMN_CONFIRM_FIREBASE_PROJECT: undefined }],
    ['demo- project in firebase mode', { ...REAL, CMN_FIREBASE_PROJECT_ID: 'demo-cmn-s2b2', CMN_CONFIRM_FIREBASE_PROJECT: 'demo-cmn-s2b2' }],
    ['an emulator host is set', { ...REAL, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }],
    ['auth emulator host is set', { ...REAL, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }],
    ['GCLOUD_PROJECT points elsewhere', { ...REAL, GCLOUD_PROJECT: 'cmn-other' }],
    ['no credential source', { ...REAL, CMN_GCP_CREDENTIALS: undefined }],
    ['key-file credential source', { ...REAL, CMN_GCP_CREDENTIALS: 'keyfile' }],
    ['invalid project id', { ...REAL, CMN_FIREBASE_PROJECT_ID: 'X', CMN_CONFIRM_FIREBASE_PROJECT: 'X' }],
  ]) test(`refused: ${why}`, () => assert.throws(() => resolveConfig(env), ConfigError));
  test('emulator mode keeps the upstream guard (demo- project, loopback hosts)', () => {
    assert.throws(() => resolveConfig({ CMN_API_MODE: 'emulator', FIRESTORE_EMULATOR_HOST: 'example.com:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }));
    const c = resolveConfig({ CMN_API_MODE: 'emulator', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' });
    assert.equal(c.mode, 'emulator'); assert.match(c.projectId, /^demo-/);
  });
});

describe('credentials (server/credentials.mjs)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cmn-adc-'));
  const file = (o) => { const f = path.join(dir, `${Math.random()}.json`); writeFileSync(f, JSON.stringify(o)); return f; };
  test('a service-account KEY file is refused (no private keys)', () => {
    assert.throws(() => createAccessTokenSource('adc', { env: { GOOGLE_APPLICATION_CREDENTIALS: file({ type: 'service_account', private_key: 'x' }) } }), /refused/);
  });
  test('missing ADC → clear instruction', () => assert.throws(() => createAccessTokenSource('adc', { env: { GOOGLE_APPLICATION_CREDENTIALS: path.join(dir, 'none.json') } }), /gcloud auth application-default login/));
  test('authorized_user ADC: refresh once, cached until shortly before expiry, user project header', async () => {
    let calls = 0; let t = 1000000;
    const f = async (url, init) => { calls += 1; assert.equal(url, 'https://oauth2.googleapis.com/token'); assert.match(String(init.body), /grant_type=refresh_token/); return { status: 200, json: async () => ({ access_token: `at-${calls}`, expires_in: 3600 }) }; };
    const src = createAccessTokenSource('adc', { env: { GOOGLE_APPLICATION_CREDENTIALS: file({ type: 'authorized_user', client_id: 'c', client_secret: 's', refresh_token: 'r' }) }, fetch: f, now: () => t });
    assert.equal(src.userProject, true);
    assert.equal(await src.accessToken(), 'at-1'); assert.equal(await src.accessToken(), 'at-1'); assert.equal(calls, 1);
    t += 3600 * 1000; assert.equal(await src.accessToken(), 'at-2');
  });
  test('metadata source: asks the metadata server with Metadata-Flavor; no user project header', async () => {
    const f = async (url, init) => { assert.match(url, /^http:\/\/metadata\.google\.internal\//); assert.equal(init.headers['metadata-flavor'], 'Google'); return { status: 200, json: async () => ({ access_token: 'sa', expires_in: 300 }) }; };
    const src = createAccessTokenSource('metadata', { fetch: f });
    assert.equal(src.userProject, false); assert.equal(await src.accessToken(), 'sa');
  });
  test('refresh failure throws (the API then answers 503, never as the user)', async () => {
    const src = createAccessTokenSource('adc', { env: { GOOGLE_APPLICATION_CREDENTIALS: file({ type: 'authorized_user', client_id: 'c', client_secret: 's', refresh_token: 'r' }) }, fetch: async () => ({ status: 400, json: async () => ({ error: 'invalid_grant' }) }) });
    await assert.rejects(src.accessToken(), /refresh failed/);
  });
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

/* ---------- a test signing key + its X.509 certificate (as Google publishes them), and token minting */
let KEY; let CERT; let OTHER;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function mint(payload, { key = KEY, kid = 'test-kid', alg = 'RS256', sig = true } = {}) {
  const h = b64({ alg, kid, typ: 'JWT' }); const p = b64(payload);
  if (!sig) return `${h}.${p}.`;
  const s = createSign('RSA-SHA256'); s.update(`${h}.${p}`); return `${h}.${p}.${s.sign(key).toString('base64url')}`;
}
const NOW = 1_800_000_000;
const good = (o = {}) => ({ iss: `https://securetoken.google.com/${P}`, aud: P, sub: 'Uid12345', user_id: 'Uid12345', iat: NOW - 10, exp: NOW + 3000, auth_time: NOW - 20, ...o });
before(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cmn-key-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=cmn-test'], { stdio: 'ignore' });
  KEY = readFileSync(path.join(dir, 'k.pem'), 'utf8'); CERT = readFileSync(path.join(dir, 'c.pem'), 'utf8');
  OTHER = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  rmSync(dir, { recursive: true, force: true });
});
const getCerts = async () => ({ 'test-kid': CERT });
const userOk = async (uid) => ({ status: 200, json: { users: [{ localId: uid, validSince: String(NOW - 100) }] } });

describe('REAL-project ID token verification (server/token-firebase.mjs)', () => {
  const v = (t, lookupUser = userOk) => verifyFirebaseIdToken(t, { projectId: P, nowSec: NOW, getCerts, lookupUser });
  test('a correctly signed token for this project is accepted → the verified uid', async () => {
    const r = await v(mint(good())); assert.equal(r.ok, true); assert.equal(r.claims.authUid, 'Uid12345');
  });
  for (const [why, tok, reason] of [
    ['unsigned (alg none, emulator-style: empty signature)', () => mint(good(), { alg: 'none', sig: false }), 'TOKEN_MALFORMED'],
    ['alg none with a non-empty signature', () => mint(good(), { alg: 'none' }), 'TOKEN_BAD_ALGORITHM'],
    ['HS256', () => mint(good(), { alg: 'HS256' }), 'TOKEN_BAD_ALGORITHM'],
    ['signed by another key (same kid)', () => mint(good(), { key: OTHER }), 'TOKEN_BAD_SIGNATURE'],
    ['unknown kid', () => mint(good(), { kid: 'nope' }), 'TOKEN_UNKNOWN_KEY'],
    ['payload changed after signing (forged uid)', () => { const t = mint(good()).split('.'); return [t[0], b64(good({ sub: 'Attacker1', user_id: 'Attacker1' })), t[2]].join('.'); }, 'TOKEN_BAD_SIGNATURE'],
    ['another project (aud)', () => mint(good({ aud: 'cmn-other' })), 'TOKEN_WRONG_AUDIENCE'],
    ['another issuer', () => mint(good({ iss: 'https://securetoken.google.com/cmn-other' })), 'TOKEN_WRONG_AUDIENCE'],
    ['expired', () => mint(good({ exp: NOW - 1 })), 'TOKEN_EXPIRED'],
    ['issued in the future', () => mint(good({ iat: NOW + 600 })), 'TOKEN_FROM_FUTURE'],
    ['sub ≠ user_id', () => mint(good({ user_id: 'Other' })), 'TOKEN_BAD_SUBJECT'],
    ['non-integer exp', () => mint(good({ exp: `${NOW + 9}` })), 'TOKEN_BAD_TIME'],
    ['auth_time after iat', () => mint(good({ auth_time: NOW })), 'TOKEN_BAD_TIME'],
    ['malformed', () => 'abc.def', 'TOKEN_MALFORMED'],
  ]) test(`refused: ${why} → ${reason}`, async () => { const r = await v(tok()); assert.equal(r.ok, false); assert.equal(r.reason, reason); });
  test('account state: missing, disabled, revoked (iat < validSince), lookup unavailable', async () => {
    assert.equal((await v(mint(good()), async () => ({ status: 200, json: { users: [] } }))).reason, 'TOKEN_USER_NOT_FOUND');
    assert.equal((await v(mint(good()), async (u) => ({ status: 200, json: { users: [{ localId: u, disabled: true }] } }))).reason, 'TOKEN_USER_DISABLED');
    assert.equal((await v(mint(good()), async (u) => ({ status: 200, json: { users: [{ localId: u, validSince: String(NOW) }] } }))).reason, 'TOKEN_REVOKED');
    // like the Admin SDK: the SIGN-IN time (auth_time) is compared with validSince, not the token refresh time
    assert.equal((await v(mint(good({ auth_time: NOW - 20, iat: NOW - 5 })), async (u) => ({ status: 200, json: { users: [{ localId: u, validSince: String(NOW - 10) }] } }))).reason, 'TOKEN_REVOKED');
    assert.equal((await v(mint(good({ auth_time: NOW - 20, iat: NOW - 5 })), async (u) => ({ status: 200, json: { users: [{ localId: u, validSince: String(NOW - 30) }] } }))).ok, true);
    assert.equal((await v(mint(good()), async () => ({ status: 0, json: null }))).reason, 'AUTH_UNAVAILABLE');
    assert.equal((await v(mint(good()), async () => ({ status: 200, json: { users: [{ localId: 'someone-else' }] } }))).reason, 'TOKEN_USER_NOT_FOUND');
  });
  test('certificates unavailable → AUTH_UNAVAILABLE (fail closed); certificate cache honours max-age', async () => {
    assert.equal((await checkFirebaseTokenClaims(mint(good()), { projectId: P, nowSec: NOW, getCerts: async () => null })).reason, 'AUTH_UNAVAILABLE');
    let n = 0; let t = 0; const cache = createCertCache({ fetchJson: async () => { n += 1; return { status: 200, json: { k: 'x' }, maxAgeSec: 60 }; }, now: () => t });
    await cache(); await cache(); assert.equal(n, 1); t = 61000; await cache(); assert.equal(n, 2);
  });
});

describe('firebase backend (server/backend.mjs)', () => {
  test('only this project\'s Firestore documents and the accounts:lookup admin endpoint are reachable', () => {
    const b = createFirebaseBackend({ projectId: P, tokens: { accessToken: async () => 'x', userProject: false } });
    assert.equal(b.docsBase, `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`);
    b.checkUrl(`${b.docsBase}/authBindings/u`); b.checkUrl(`${b.docsBase}:runQuery`);
    b.checkUrl(`https://identitytoolkit.googleapis.com/v1/projects/${P}/accounts:lookup`);
    for (const bad of [`https://firestore.googleapis.com/v1/projects/cmn-other/databases/(default)/documents/x`, 'http://127.0.0.1:8080/v1/projects/x', 'https://evil.example/x', `https://identitytoolkit.googleapis.com/v1/projects/${P}/accounts:update`]) assert.throws(() => b.checkUrl(bad), /not allowed/, bad);
    assert.deepEqual(Object.keys(GOOGLE_ENDPOINTS).sort(), ['certs', 'firestore', 'identityToolkit']);
  });
  test('user-project header only for the owner\'s ADC (quota project), never a key', async () => {
    const a = createFirebaseBackend({ projectId: P, tokens: { accessToken: async () => 'tok', userProject: true } });
    assert.deepEqual(await a.headers(), { authorization: 'Bearer tok', 'x-goog-user-project': P });
    const m = createFirebaseBackend({ projectId: P, tokens: { accessToken: async () => 'tok', userProject: false } });
    assert.deepEqual(await m.headers(), { authorization: 'Bearer tok' });
  });
});

test('vendored upstream business logic is byte-identical to class-management-next 1e20989 (server/upstream/UPSTREAM.json)', () => {
  const m = JSON.parse(readFileSync(path.join(ROOT, 'server', 'upstream', 'UPSTREAM.json'), 'utf8'));
  assert.equal(m.commit, '1e20989ea6393c12dd18e11db617873c297a9f4a');
  for (const [f, h] of Object.entries(m.files)) assert.equal(createHash('sha256').update(readFileSync(path.join(ROOT, 'server', 'upstream', f))).digest('hex'), h, f);
  const up = process.env.CMN_UPSTREAM_ROOT;   // optional: compare with a real upstream checkout too
  if (up) for (const f of Object.keys(m.files)) assert.equal(execFileSync('git', ['-C', up, 'show', `${m.commit}:${f}`]).toString(), readFileSync(path.join(ROOT, 'server', 'upstream', f), 'utf8'), f);
});
