/** FIREBASE-MODE code path, end to end, on the local emulators (SPEC §12.7). NOT real Google:
 *  - the controlled API runs with createFirebaseBackend (the real-mode backend: RS256 token verification, admin
 *    accounts:lookup, the API's own credentials, URL allow-list);
 *  - its endpoints are pointed at the emulators (Firestore REST + Identity Toolkit admin are the same APIs), and the
 *    "Google certificates" come from a local server holding a throw-away TEST key;
 *  - ID tokens are RS256 tokens minted with that test key for real emulator users of the fictional world.
 *  What this proves: the firebase-mode API refuses emulator (unsigned) tokens and forged / expired / foreign tokens,
 *  checks account state, and keeps authorization + the W1 transaction rules. What it does NOT prove: anything about
 *  Google's real sign-in, certificates or IAM. Runs only inside `firebase emulators:exec`:
 *    node test/run-e2e.mjs --upstream <path> --script firebase-mode */
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createSign, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openUpstream } from '../dev/world.mjs';
import { createApi } from '../server/api.mjs';
import { createFirebaseBackend } from '../server/backend.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.W1_OUT || path.join(HERE, '..', 'test-results', `firebase-mode-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}`);
mkdirSync(OUT, { recursive: true });
const results = []; const log = (ok, name, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const up = await openUpstream(process.env.CMN_UPSTREAM_STAGE2);
const P = up.cfg.projectId;
const users = await up.h.seedWorld();
const kd = mkdtempSync(path.join(os.tmpdir(), 'cmn-fbkey-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(kd, 'k.pem'), '-out', path.join(kd, 'c.pem'), '-days', '1', '-subj', '/CN=cmn-firebase-mode-test'], { stdio: 'ignore' });
const KEY = readFileSync(path.join(kd, 'k.pem'), 'utf8'); const CERT = readFileSync(path.join(kd, 'c.pem'), 'utf8');
rmSync(kd, { recursive: true, force: true });
const certServer = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' }); r.end(JSON.stringify({ 'test-kid': CERT })); });
await new Promise((r) => certServer.listen(0, '127.0.0.1', r));
const backend = createFirebaseBackend({ projectId: P, tokens: { accessToken: async () => 'owner', userProject: false },
  endpoints: { firestore: up.cfg.firestore.origin, identityToolkit: `${up.cfg.auth.origin}/identitytoolkit.googleapis.com`, certs: `http://127.0.0.1:${certServer.address().port}/certs` } });
const api = createApi({ port: 0, backend });
const port = await api.listen();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);
function mint(uid, o = {}, { alg = 'RS256', kid = 'test-kid' } = {}) {
  const t = nowSec();
  const h = b64({ alg, kid, typ: 'JWT' }); const p = b64({ iss: `https://securetoken.google.com/${P}`, aud: P, sub: uid, user_id: uid, iat: t, exp: t + 3000, auth_time: t, ...o });
  const s = createSign('RSA-SHA256'); s.update(`${h}.${p}`); return `${h}.${p}.${s.sign(KEY).toString('base64url')}`;
}
const post = async (p, body, token) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const SC = { workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01' }; const A17 = { workspaceId: 'WS-A17', classId: 'CLASS-606-A17' };
const readSes = (scope, sessionId, token) => post('/v1/read', { op: 'attendanceSession.read', target: { sessionId }, claimedScope: scope }, token);
const docs = async () => (await up.h.exportState()).docs;
const auditsOf = (d) => Object.entries(d).filter(([k]) => /\/auditLog\/[^/]+$|^auditLogUnscoped\/[^/]+$/.test(k)).map(([, v]) => v);
const lastReason = async (uid) => { const a = auditsOf(await docs()).filter((x) => (uid ? x.authUid === uid : true)); return a.map((x) => x.reasonCode); };
const sc01 = users['ACTOR-SC01-TEACHER'].uid; const teacher = users['ACTOR-TEACHER'].uid;
const command = (operationId, expectedVersion) => ({ command: { schemaVersion: '1.0', workspaceId: 'WS-SC01', operationId, commandType: 'LeaveRecord.Revise', targetType: 'LeaveRecord', targetId: 'LV-007', expectedVersion, intent: { coverageChange: 'AM_TO_FULL_DAY', reasonCode: 'SOURCE_CORRECTION' }, clientCreatedAt: new Date().toISOString() }, claimedScope: SC });

try {
  /* F1 a correctly signed token → only the user's own class */
  {
    const t = mint(sc01);
    const own = await readSes(SC, 'AS-SC01-20261116-DAILY', t); const other = await readSes(A17, 'AS-A17-20261117-DAILY', t); const forged = await readSes(SC, 'AS-A17-20261117-DAILY', t);
    const a = auditsOf(await docs()).filter((x) => x.authUid === sc01);
    log(own.status === 200 && own.body.code === 'OK' && other.status === 403 && forged.status === 403 && a.some((x) => x.decision === 'allow' && x.principalId === 'ACTOR-SC01-TEACHER'),
      'F1 firebase mode, signed token: own class 200; another workspace 403; forged claimed scope 403; audited with the verified uid', `own=${own.status} other=${other.status} forged=${forged.status}`);
  }
  /* F2 tokens firebase mode must refuse */
  {
    const emulatorTok = users['ACTOR-SC01-TEACHER'].token;   // a genuine EMULATOR token (alg none): accepted in emulator mode only
    const h = b64({ alg: 'RS256', kid: 'test-kid' }); const t0 = nowSec();
    const tampered = (() => { const [a, , c] = mint(sc01).split('.'); return [a, b64({ iss: `https://securetoken.google.com/${P}`, aud: P, sub: teacher, user_id: teacher, iat: t0, exp: t0 + 3000 }), c].join('.'); })();
    const cases = {
      emulatorToken: await readSes(SC, 'AS-SC01-20261116-DAILY', emulatorTok),
      tamperedUid: await readSes(SC, 'AS-SC01-20261116-DAILY', tampered),
      unknownKid: await readSes(SC, 'AS-SC01-20261116-DAILY', mint(sc01, {}, { kid: 'other' })),
      expired: await readSes(SC, 'AS-SC01-20261116-DAILY', mint(sc01, { iat: t0 - 4000, exp: t0 - 10, auth_time: t0 - 4000 })),
      otherProject: await readSes(SC, 'AS-SC01-20261116-DAILY', mint(sc01, { aud: 'cmn-other', iss: 'https://securetoken.google.com/cmn-other' })),
      noToken: await readSes(SC, 'AS-SC01-20261116-DAILY', null),
      notAUser: await readSes(SC, 'AS-SC01-20261116-DAILY', mint('NoSuchUser123')),
      garbage: await readSes(SC, 'AS-SC01-20261116-DAILY', `${h}.x.y`),
    };
    const reasons = new Set(auditsOf(await docs()).map((x) => x.reasonCode));
    log(Object.values(cases).every((r) => r.status === 403 && r.body?.code === 'FORBIDDEN') && ['TOKEN_MALFORMED', 'TOKEN_BAD_SIGNATURE', 'TOKEN_UNKNOWN_KEY', 'TOKEN_EXPIRED', 'TOKEN_WRONG_AUDIENCE', 'TOKEN_MISSING', 'TOKEN_USER_NOT_FOUND'].every((x) => reasons.has(x)),
      'F2 firebase mode refuses: a genuine EMULATOR (unsigned) token, a tampered uid, an unknown key, expired, another project, no token, a non-existent user, garbage — all the same 403, each reason audited', JSON.stringify(Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v.status]))));
  }
  /* F3 W1 transaction rules through the firebase-mode API */
  {
    const t = mint(sc01);
    const lv = await post('/v1/read', { op: 'leaveRecord.read', target: { leaveRecordId: 'LV-007' }, claimedScope: SC }, t);
    const entryBefore = JSON.stringify(Object.entries(await docs()).filter(([k]) => /attendanceSessions\/AS-SC01-20261116-DAILY\/entries\//.test(k)));
    const op1 = randomUUID(); const body1 = command(op1, lv.body.data.version);
    const c1 = await post('/v1/commit', body1, t);
    const again = await post('/v1/commit', body1, t);                                          // same operation, same body
    const mismatch = await post('/v1/commit', { ...body1, command: { ...body1.command, intent: { ...body1.command.intent, reasonCode: 'OTHER' } } }, t);
    const stale = await post('/v1/commit', command(randomUUID(), lv.body.data.version), t);   // a NEW operation on the old version
    const rec = await post('/v1/receipt', { operationId: op1, workspaceId: 'WS-SC01' }, t);
    const d = await docs();
    const revs = Object.keys(d).filter((k) => /\/leaveRecords\/LV-007\/revisions\/[^/]+$/.test(k));
    const entryAfter = JSON.stringify(Object.entries(d).filter(([k]) => /attendanceSessions\/AS-SC01-20261116-DAILY\/entries\//.test(k)));
    log(lv.status === 200 && c1.status === 200 && c1.body.receipt.operationId === op1 && again.status === 200 && JSON.stringify(again.body.receipt) === JSON.stringify(c1.body.receipt)
      && mismatch.status === 409 && mismatch.body.code === 'OPERATION_REUSE_MISMATCH' && stale.status === 409 && stale.body.code === 'VERSION_CONFLICT'
      && rec.status === 200 && rec.body.receipt.operationId === op1 && revs.length === 1 && entryBefore === entryAfter,
      'F3 firebase mode keeps the W1 rules: commit → receipt; same operation again → the SAME receipt; same id, other content → OPERATION_REUSE_MISMATCH; new operation on the old version → VERSION_CONFLICT; receipt query; ONE revision; attendance unchanged',
      `commit=${c1.status} again=${again.status} mismatch=${mismatch.body?.code} stale=${stale.body?.code} receipt=${rec.status} revisions=${revs.length}`);
    const otherRec = await post('/v1/receipt', { operationId: op1, workspaceId: 'WS-SC01' }, mint(teacher));
    log(otherRec.status === 403, 'F3b another user cannot read this receipt (403)');
  }
  /* F4 account state and binding state */
  {
    await up.h.disableAuthUser(teacher);
    const dis = await readSes(A17, 'AS-A17-20261117-DAILY', mint(teacher));
    const t = nowSec();
    const rv = await fetch(`${up.cfg.auth.origin}/identitytoolkit.googleapis.com/v1/projects/${P}/accounts:update`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId: sc01, validSince: String(t + 2) }) });
    const revoked = await readSes(SC, 'AS-SC01-20261116-DAILY', mint(sc01));                 // iat < validSince
    await new Promise((r) => setTimeout(r, 3200));
    const fresh = await readSes(SC, 'AS-SC01-20261116-DAILY', mint(sc01));                   // issued after validSince
    await up.h.patchDoc(`authBindings/${sc01}`, { status: 'disabled' });
    const unbound = await readSes(SC, 'AS-SC01-20261116-DAILY', mint(sc01));
    const reasons = await lastReason();
    log(dis.status === 403 && reasons.includes('TOKEN_USER_DISABLED') && rv.status === 200 && revoked.status === 403 && reasons.includes('TOKEN_REVOKED') && fresh.status === 200 && unbound.status === 403 && reasons.includes('BINDING_NOT_ACTIVE'),
      'F4 firebase mode checks state on every request: disabled account → 403; token older than validSince (revoked) → 403, a newer one 200; binding disabled → 403', `disabled=${dis.status} revoked=${revoked.status}(update ${rv.status}) fresh=${fresh.status} unbound=${unbound.status}`);
  }
} catch (e) {
  log(false, 'firebase-mode aborted', String(e.stack || e).split('\n').slice(0, 4).join(' | '));
} finally {
  await api.close(); await new Promise((r) => certServer.close(r)); await up.close();
}
writeFileSync(path.join(OUT, 'firebase-mode-results.json'), JSON.stringify({ kind: 'firebase-mode API code path on local emulators with a TEST signing key — NOT real Google', results }, null, 2));
const ok = results.length > 0 && results.every((r) => r.ok);
console.log(`W1_E2E ok=${ok} checks=${results.filter((r) => r.ok).length}/${results.length} out=${OUT}`);
process.exit(ok ? 0 : 1);
