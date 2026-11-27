#!/usr/bin/env node
/** TRUSTED administration script (SPEC §12.5) — run by the OWNER on the owner's own computer, never by the page.
 *  It is the ONLY way a Google account gets class access in this version: no self-service, no auto-join,
 *  no "first user becomes admin". It binds a Firebase UID to an EXISTING principal; the principal's memberships
 *  (workspace / class / capabilities) are not changed here.
 *
 *    CMN_API_MODE=emulator|firebase (+ firebase settings, server/config.mjs) node server/admin.mjs <command>
 *      list-bindings
 *      bind   --uid <Firebase UID> --principal <principalId>     (principal must exist and be active)
 *      unbind --uid <Firebase UID>                                (status → disabled; the record is kept)
 *      seed-fictional --upstream <class-management-next checkout> --confirm-fictional
 *             write the FIXED FICTIONAL Stage 1 world (principals, workspaces, classes, rosters, sessions, LV-007)
 *             into an EMPTY project; refuses if any workspace exists. Never real data.
 *  Every change is recorded in auditLogUnscoped (action admin.*). Credentials: CMN_GCP_CREDENTIALS (no key files). */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolveConfig } from './config.mjs';
import { createAccessTokenSource } from './credentials.mjs';
import { createEmulatorBackend, createFirebaseBackend } from './backend.mjs';
import { fromFields, toFields } from './store.mjs';

const UID_RE = /^[A-Za-z0-9]{1,128}$/; const ID_RE = /^[A-Z0-9][A-Z0-9-]{1,63}$/;
const isoSec = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

export function backendFromEnv(env = process.env) {
  const cfg = resolveConfig(env);
  return cfg.mode === 'emulator'
    ? createEmulatorBackend({ projectId: cfg.projectId, origin: cfg.firestoreOrigin })   // admin talks to the emulator directly
    : createFirebaseBackend({ projectId: cfg.projectId, tokens: createAccessTokenSource(cfg.credentials, { env }) });
}

/** Admin operations on one backend (also used by the E2E in emulator mode). */
export function createAdmin(backend, { actor = 'owner-cli', now = () => Date.now() } = {}) {
  const base = backend.docsBase;
  async function call(url, { method = 'GET', body } = {}) {
    backend.checkUrl(url);
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(await backend.headers()) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10000) });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* */ }
    return { status: r.status, json: j };
  }
  const get = async (p) => { const r = await call(`${base}/${p}`); if (r.status === 404) return null; if (r.status !== 200) throw new Error(`read ${p}: ${r.status}`); return fromFields(r.json.fields); };
  const put = async (p, data, { mustNotExist = false } = {}) => { const r = await call(`${base}/${p}${mustNotExist ? '?currentDocument.exists=false' : ''}`, { method: 'PATCH', body: { fields: toFields(data) } }); if (r.status !== 200) throw new Error(`write ${p}: ${r.status}`); };
  const audit = (action, detail) => put(`auditLogUnscoped/${randomUUID()}`, { at: new Date(now()).toISOString(), actor, action, ...detail, decision: 'admin' }, { mustNotExist: true });
  return {
    async listBindings() {
      const r = await call(`${base}/authBindings?pageSize=300`);
      if (r.status !== 200) throw new Error(`list: ${r.status}`);
      return (r.json?.documents || []).map((d) => fromFields(d.fields));
    },
    async bind(uid, principalId) {
      if (!UID_RE.test(uid || '')) throw new Error('bind: --uid must be a Firebase UID');
      if (!ID_RE.test(principalId || '')) throw new Error('bind: --principal must be a principal id');
      const p = await get(`principals/${principalId}`);
      if (!p || p.principalId !== principalId || p.status !== 'active') throw new Error(`bind: principal ${principalId} does not exist or is not active`);
      const cur = await get(`authBindings/${uid}`);
      if (cur && cur.status === 'active' && cur.principalId !== principalId) throw new Error(`bind: ${uid} is already bound to ${cur.principalId}; unbind first`);
      const doc = { authUid: uid, principalId, status: 'active', activatedAt: isoSec(now()), bindingVersion: (cur?.bindingVersion || 0) + 1 };
      await put(`authBindings/${uid}`, doc);
      await audit('admin.bind', { authUid: uid, principalId });
      return doc;
    },
    async unbind(uid) {
      if (!UID_RE.test(uid || '')) throw new Error('unbind: --uid must be a Firebase UID');
      const cur = await get(`authBindings/${uid}`);
      if (!cur) throw new Error(`unbind: no binding for ${uid}`);
      const doc = { ...cur, status: 'disabled', bindingVersion: (cur.bindingVersion || 0) + 1 };
      await put(`authBindings/${uid}`, doc);
      await audit('admin.unbind', { authUid: uid, principalId: cur.principalId });
      return doc;
    },
    async seedFictional(upstreamRoot) {
      const stage2 = path.join(upstreamRoot, 'poc', 'stage2');
      const { loadFixtures } = await import(pathToFileURL(path.join(stage2, 'src', 'seed.mjs')).href);
      const { buildWorld } = await import(pathToFileURL(path.join(stage2, 'src', 'world.mjs')).href);
      const r = await call(`${base}/workspaces?pageSize=1`);
      if (r.status !== 200) throw new Error(`seed: list workspaces ${r.status}`);
      if ((r.json?.documents || []).length) throw new Error('seed: the project already has workspaces — refusing to write into a non-empty project');
      const docs = buildWorld(loadFixtures().fixtures);
      for (const d of docs) await put(d.path, d.data, { mustNotExist: true });
      await audit('admin.seedFictional', { documents: docs.length });
      return docs.length;
    },
  };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : null; };
  const admin = createAdmin(backendFromEnv());
  if (cmd === 'list-bindings') { for (const b of await admin.listBindings()) console.log(`${b.authUid}  → ${b.principalId}  ${b.status}  (v${b.bindingVersion}, since ${b.activatedAt})`); return; }
  if (cmd === 'bind') { const d = await admin.bind(arg('--uid'), arg('--principal')); console.log(`bound ${d.authUid} → ${d.principalId} (v${d.bindingVersion}). The user signs out and in again (or presses 重新檢查).`); return; }
  if (cmd === 'unbind') { const d = await admin.unbind(arg('--uid')); console.log(`disabled the binding of ${d.authUid} (was ${d.principalId}). Takes effect on the next request.`); return; }
  if (cmd === 'seed-fictional') {
    if (!rest.includes('--confirm-fictional')) throw new Error('seed-fictional writes the FICTIONAL test world; add --confirm-fictional');
    const n = await admin.seedFictional(path.resolve(arg('--upstream') || '')); console.log(`wrote ${n} fictional documents`); return;
  }
  console.log('usage: node server/admin.mjs list-bindings | bind --uid <uid> --principal <id> | unbind --uid <uid> | seed-fictional --upstream <path> --confirm-fictional');
  process.exitCode = 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`REFUSED: ${e.message}`); process.exit(2); });
