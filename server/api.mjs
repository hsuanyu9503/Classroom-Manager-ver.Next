/** Controlled API — FORK of upstream src/api/server.mjs (class-management-next 1e20989), see server/README.md.
 *  CHANGED vs upstream (only these): the backend (emulator | firebase) is injected (backend.mjs): token verification,
 *  Firestore base URL / URL check / credentials; the emulator-only and demo-only guards moved to config.mjs; the
 *  test-only mutation hooks were removed. UNCHANGED: routes, request shapes, authorization (authz.mjs) before any
 *  data, audit-before-response, identical FORBIDDEN for "missing" and "not allowed", commit / receipt rules.
 *
 *  Upstream description follows.
 *  S2-B2 local controlled API (loopback only, emulator mode only).
 *
 *  POST /v1/read  { op, target: {<idField>: id}, claimedScope: {workspaceId, classId} }          (batch 2)
 *  POST /v1/commit { command: <canonicalCommand>, claimedScope: {workspaceId, classId} }         (B4, §6.5 / §8)
 *  POST /v1/receipt { operationId, workspaceId }                                                  (B4, §6.4 / §8)
 *    Authorization: Bearer <Auth Emulator ID token>
 *  → 200 { code: 'OK', traceId, data | receipt [, derivedStatus] }
 *  → 403 { code: 'FORBIDDEN', traceId }  (identical for "does not exist" and "not allowed", §6.6)
 *  → 409 { code: 'VERSION_CONFLICT' } | { code: 'OPERATION_REUSE_MISMATCH', operationId }   (commit only)
 *  → 400 { code: 'INVALID_INPUT' }       (commit only, AFTER authorization, §6.6)
 *  → 503 { code: 'UNAVAILABLE', traceId [, reason: 'TRANSACTION_CONTENTION'] } (backend; no data)
 *
 *  Rules:
 *   - Every request re-runs token checks and §6.1/§6.2 authorization against authoritative documents.
 *   - The caller never supplies owner access, principal, workspace or class: scope comes from the
 *     resolved document path; the claimed scope must match it.
 *   - Every decision (allow and deny) is appended to auditLog BEFORE the response is sent; if the audit
 *     write fails the request fails closed (UNAVAILABLE).
 *   - /v1/commit authorizes (leave.revise) BEFORE any receipt is read (§6.5); /v1/receipt needs no capability,
 *     only the caller's own valid identity, ownership of the stored receipt and a valid class membership. */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { authorize, checkReceiptAccess, OPERATIONS, WRITE_OPERATIONS, RECEIPT_OPERATION, POLICY_VERSION } from './upstream/poc/stage2/src/authz.mjs';
import { createStore, BackendUnavailable, toFields } from './store.mjs';
import { createTxnClient } from './txn.mjs';
import { checkCommitShape, validateCommand, processCommit, receiptOut, WRITE_OP } from './upstream/poc/stage2/src/api/commit.mjs';
import { checkReceiptShape, ROUTES } from './upstream/poc/stage2/src/api/request-shape.mjs';
import { TRACE_HEADER, TRACE_ID_RE } from './upstream/poc/stage2/src/trace-proxy.mjs';
import { buildData, IntegrityError } from './upstream/poc/stage2/src/api/response-shape.mjs';

export { checkRequestShape } from './upstream/poc/stage2/src/api/request-shape.mjs';
import { checkRequestShape } from './upstream/poc/stage2/src/api/request-shape.mjs';

export const UNSCOPED_AUDIT_COLLECTION = 'auditLogUnscoped';   // gap G-2: denials whose workspace is unknown
const DERIVED_STATUSES = new Set(['pending', 'done', 'failed']);
const ROUTE_KIND = Object.freeze({ [ROUTES.read]: 'read', [ROUTES.commit]: 'commit', [ROUTES.receipt]: 'receipt' });

/** @param deps.backend    createEmulatorBackend(...) | createFirebaseBackend(...) (backend.mjs)
 *  @param deps.authorizeFn injectable ONLY so tests can prove a broken authorization is caught */
export function createApi({ port, host = '127.0.0.1', backend, now = () => Date.now(), authorizeFn = authorize }) {
  if (!backend || !['emulator', 'firebase'].includes(backend.mode)) throw new Error('API: a backend (emulator | firebase) is required');
  const mutation = null;   // upstream B4 mutation hooks are not part of this fork
  const projectId = backend.projectId;

  const server = http.createServer(async (req, res) => {
    const hdr = req.headers[TRACE_HEADER];
    const traceId = typeof hdr === 'string' && TRACE_ID_RE.test(hdr) ? hdr : `TR-${randomUUID()}`;
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...body, traceId })); };
    const store = createStore({ backend, traceId });
    const nowMs = now();
    let body = null;
    let audit = { authUid: null, principalId: null, action: null, resourceRef: null, decision: 'deny', reasonCode: 'REQUEST_INVALID', workspaceId: null };
    const route = req.method === 'POST' && Object.hasOwn(ROUTE_KIND, req.url) ? ROUTE_KIND[req.url] : null;
    try {
      if (!route) { audit.reasonCode = 'ROUTE_NOT_FOUND'; return await finish(403, { code: 'FORBIDDEN' }); }
      const text = await new Promise((resolve, reject) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 65536) reject(new Error('too large')); }); req.on('end', () => resolve(s)); req.on('error', reject); });
      try { body = JSON.parse(text); } catch { body = null; }
      // action is recorded only for a well-shaped request naming an OWN operation key (R1-N5; matches the trace)
      if (route === 'read') audit.action = checkRequestShape(body) && Object.hasOwn(OPERATIONS, body.op) ? body.op : null;
      else if (route === 'commit') audit.action = checkCommitShape(body) ? WRITE_OP : null;
      else audit.action = checkReceiptShape(body) ? RECEIPT_OPERATION : null;
      // §6.1 step 1
      const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      const v = m ? await backend.verifyIdToken(m[1], { nowSec: Math.floor(nowMs / 1000), traceHeaders: { [TRACE_HEADER]: traceId } }) : { ok: false, reason: 'TOKEN_MISSING' };
      if (!v.ok) { if (v.reason === 'AUTH_UNAVAILABLE') throw new BackendUnavailable('auth'); audit.reasonCode = v.reason; return await finish(403, { code: 'FORBIDDEN' }); }
      audit.authUid = v.claims.authUid;
      if (route === 'commit') return await handleCommit(v.claims);
      if (route === 'receipt') return await handleReceipt(v.claims);
      // Unknown / nested request fields: refused before authorization (format errors are FORBIDDEN, §6.6)
      if (!checkRequestShape(body)) { audit.reasonCode = 'REQUEST_SHAPE_INVALID'; return await finish(403, { code: 'FORBIDDEN' }); }
      // §6.1 steps 2–3, §6.2 steps 5–6
      const az = await authorizeFn({ op: body?.op, claims: v.claims, target: body?.target, claimedScope: body?.claimedScope, nowMs, store });
      audit = { ...audit, principalId: az.principalId ?? null, resourceRef: az.resource ?? null, decision: az.decision, reasonCode: az.reasonCode, workspaceId: az.scope?.workspaceId ?? null };
      if (az.decision !== 'allow') return await finish(403, { code: 'FORBIDDEN' });
      let data;
      try { data = await buildData(body.op, az, store); } catch (e) {
        if (!(e instanceof IntegrityError)) throw e;
        // REV001/REV003: inconsistent or malformed data anywhere in the response → whole request denied
        audit = { ...audit, decision: 'deny', reasonCode: e.reasonCode, outcome: e.detail.slice(0, 200) };
        return await finish(403, { code: 'FORBIDDEN' });
      }
      if (data === null) { audit.outcome = 'NOT_IMPLEMENTED_NO_TRUSTED_CALENDAR'; return await finish(503, { code: 'UNAVAILABLE' }); }
      return await finish(200, { code: 'OK', data });
    } catch (e) {
      if (e instanceof IntegrityError) {
        // inconsistent stored data met by a write / receipt handler → the whole request is denied
        audit = { ...audit, decision: 'deny', reasonCode: e.reasonCode, outcome: e.detail.slice(0, 200) };
        try { return await finish(403, { code: 'FORBIDDEN' }); } catch { /* audit failed → fall through to 503 */ }
      }
      audit = { ...audit, decision: audit.decision === 'allow' ? 'allow' : 'deny', outcome: 'BACKEND_UNAVAILABLE' };
      try { await writeAudit(); } catch { /* backend gone: nothing more we can record */ }
      if (!res.headersSent) send(503, { code: 'UNAVAILABLE' });
    }

    /** B4 §8 step 1 → 5. Authorization (leave.revise) first; nothing here reads a receipt before it passed. */
    async function handleCommit(claims) {
      if (!checkCommitShape(body)) { audit.reasonCode = 'REQUEST_SHAPE_INVALID'; return finish(403, { code: 'FORBIDDEN' }); }
      const c = body.command;
      const az = await authorizeFn({ op: WRITE_OP, claims, target: { leaveRecordId: c.targetId }, claimedScope: body.claimedScope, nowMs, store, operations: WRITE_OPERATIONS });
      audit = { ...audit, principalId: az.principalId ?? null, resourceRef: az.resource ?? null, decision: az.decision, reasonCode: az.reasonCode, workspaceId: az.scope?.workspaceId ?? null };
      if (az.decision !== 'allow') return finish(403, { code: 'FORBIDDEN' });
      const bad = validateCommand(c);
      if (bad) { audit.outcome = `INVALID_INPUT:${bad}`; return finish(400, { code: 'INVALID_INPUT' }); }
      const txn = createTxnClient({ backend, traceId });
      const r = await processCommit({ command: c, scope: az.scope, principalId: az.principalId, currentPath: az.resource, txn, toFields, nowMs: now, mutation });
      audit = { ...audit, outcome: r.outcome, operationId: c.operationId, requestHash: r.requestHash, attempts: r.attempts, transactionRef: r.transactionRef };
      return finish(r.status, r.body);
    }
    /** B4 receipt query (§6.4, §8; plan v0.2 §3.1.2): no capability, no commit, no write (audit only). */
    async function handleReceipt(claims) {
      if (!checkReceiptShape(body)) { audit.reasonCode = 'REQUEST_SHAPE_INVALID'; return finish(403, { code: 'FORBIDDEN' }); }
      const az = await checkReceiptAccess({ claims, workspaceId: body.workspaceId, operationId: body.operationId, nowMs, store });
      audit = { ...audit, principalId: az.principalId ?? null, resourceRef: az.resource ?? null, decision: az.decision, reasonCode: az.reasonCode, workspaceId: az.resource ? body.workspaceId : null };
      if (az.decision !== 'allow') return finish(403, { code: 'FORBIDDEN' });
      const receipt = receiptOut(az.receipt);
      const dp = await store.getDoc(`workspaces/${body.workspaceId}/derivedProgress/${body.operationId}`);
      if (!dp || dp.operationId !== body.operationId || !DERIVED_STATUSES.has(dp.derivedStatus)) throw new IntegrityError('DATA_INTEGRITY_ERROR', 'derivedProgress missing or invalid');
      return finish(200, { code: 'OK', receipt, derivedStatus: dp.derivedStatus });
    }

    async function writeAudit() {
      const auditId = randomUUID();
      const doc = { auditId, at: new Date(nowMs).toISOString(), authUid: audit.authUid, principalId: audit.principalId, action: audit.action, resourceRef: audit.resourceRef, decision: audit.decision, reasonCode: audit.reasonCode, policyVersion: POLICY_VERSION, traceId, ...(audit.outcome ? { outcome: audit.outcome } : {}) };
      // B4 write evidence: what the API itself claims about the commit (reconciled against the back trace)
      for (const k of ['operationId', 'requestHash', 'attempts', 'transactionRef']) if (audit[k] !== undefined) doc[k] = audit[k];
      const coll = audit.workspaceId ? `workspaces/${audit.workspaceId}/auditLog` : UNSCOPED_AUDIT_COLLECTION;
      await store.appendAudit(coll, auditId, audit.workspaceId ? { ...doc, workspaceId: audit.workspaceId } : doc);
    }
    async function finish(status, payload) {
      await writeAudit();                // fail closed: no response body before the audit record exists
      send(status, payload);
    }
  });
  return {
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server.address().port)); }),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
