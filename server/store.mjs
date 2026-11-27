/** Authoritative Firestore reads/writes for the controlled API — FORK of upstream src/api/store.mjs (1e20989):
 *  identical operations, queries and fail-closed rules; only the URL base, the URL check and the credentials come
 *  from the backend (backend.mjs) instead of the emulator-only constants. Owner / admin access lives ONLY here. */
import { TRACE_HEADER } from './upstream/poc/stage2/src/trace-proxy.mjs';
import { IntegrityError } from './upstream/poc/stage2/src/api/response-shape.mjs';
import { BackendUnavailable, fromFields, toFields } from './upstream/poc/stage2/src/api/store.mjs';

export { BackendUnavailable, fromFields, toFields };

export function createStore({ backend, traceId = null }) {
  const docsPrefix = backend.docsPrefix;
  const base = backend.docsBase;
  async function call(url, { method = 'GET', body } = {}) {
    backend.checkUrl(url);
    const headers = { 'content-type': 'application/json', ...(await backend.headers()) };
    if (traceId) headers[TRACE_HEADER] = traceId;
    let res;
    try { res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(5000) }); } catch (e) { throw new BackendUnavailable(e.message); }
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (res.status >= 500) throw new BackendUnavailable(`backend ${res.status}`);
    if (res.status === 401 || res.status === 403) throw new BackendUnavailable(`backend credentials refused (${res.status})`);   // the API's own access, never the user's
    return { status: res.status, json };
  }
  const rel = (name) => name.slice(name.indexOf(docsPrefix) + docsPrefix.length + 1);
  async function getDoc(path) {
    const r = await call(`${base}/${path}`);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new BackendUnavailable(`get ${r.status}`);
    return fromFields(r.json.fields);
  }
  async function runQuery(parentPath, structuredQuery) {
    const r = await call(`${base}${parentPath ? '/' + parentPath : ''}:runQuery`, { method: 'POST', body: { structuredQuery } });
    if (r.status !== 200 || !Array.isArray(r.json)) throw new BackendUnavailable(`runQuery ${r.status}`);
    return r.json.filter((x) => x.document).map((x) => ({ path: rel(x.document.name), data: fromFields(x.document.fields) }));
  }
  const eq = (field, value) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } });
  return {
    getBinding: (uid) => getDoc(`authBindings/${uid}`),
    getPrincipal: (pid) => getDoc(`principals/${pid}`),
    findTargets: (collection, idField, id) => runQuery('', { from: [{ collectionId: collection, allDescendants: true }], where: eq(idField, id), limit: 3 }),
    listMemberships: async (wid, pid) => (await runQuery(`workspaces/${wid}`, { from: [{ collectionId: 'memberships' }], where: eq('principalId', pid), limit: 50 }))
      .filter((x) => x.path.startsWith(`workspaces/${wid}/memberships/`)).map((x) => x.data),
    listCollection: async (collPath) => {
      const r = await call(`${base}/${collPath}?pageSize=300`);
      if (r.status !== 200) throw new BackendUnavailable(`list ${r.status}`);
      if (r.json?.nextPageToken) throw new IntegrityError('DATA_INTEGRITY_ERROR', `LIST_TRUNCATED: ${collPath}`);
      return (r.json?.documents || []).map((d) => ({ path: rel(d.name), data: fromFields(d.fields) }));
    },
    getDoc,
    appendAudit: async (collPath, auditId, data) => {
      const r = await call(`${base}/${collPath}/${auditId}?currentDocument.exists=false`, { method: 'PATCH', body: { fields: toFields(data) } });
      if (r.status !== 200) throw new BackendUnavailable(`audit write ${r.status}`);
    },
  };
}
