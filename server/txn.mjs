/** Firestore REST transactions — FORK of upstream src/api/txn.mjs (1e20989): identical begin / batchGet /
 *  commit / rollback and error classes (TxnAborted is the UPSTREAM class, so upstream commit.mjs recognises it);
 *  only the URL base, URL check and credentials come from the backend. */
import { TRACE_HEADER } from './upstream/poc/stage2/src/trace-proxy.mjs';
import { TxnAborted } from './upstream/poc/stage2/src/api/txn.mjs';
import { BackendUnavailable, fromFields } from './upstream/poc/stage2/src/api/store.mjs';

export function createTxnClient({ backend, traceId = null }) {
  const docsPrefix = backend.docsPrefix;
  const base = backend.docsBase;
  const nameOf = (p) => `${docsPrefix}/${p}`;
  const rel = (name) => (typeof name === 'string' && name.startsWith(`${docsPrefix}/`) ? name.slice(docsPrefix.length + 1) : null);
  async function call(verb, body) {
    const url = `${base}:${verb}`;
    backend.checkUrl(url);
    const headers = { 'content-type': 'application/json', ...(await backend.headers()) };
    if (traceId) headers[TRACE_HEADER] = traceId;
    let res;
    try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10000) }); } catch (e) { throw new BackendUnavailable(`${verb}: ${e.name}`); }
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (res.status === 409 && json?.error?.status === 'ABORTED') throw new TxnAborted(verb);
    if (res.status !== 200) throw new BackendUnavailable(`${verb} ${res.status}${json?.error?.status ? ' ' + json.error.status : ''}`);
    return json;
  }
  return {
    nameOf,
    async begin() {
      const j = await call('beginTransaction', { options: { readWrite: {} } });
      if (typeof j?.transaction !== 'string' || j.transaction === '') throw new BackendUnavailable('beginTransaction: no transaction id');
      return j.transaction;
    },
    async get(path, transaction) {
      const j = await call('batchGet', { documents: [nameOf(path)], transaction });
      if (!Array.isArray(j) || j.length !== 1) throw new BackendUnavailable('batchGet: unexpected shape');
      const r = j[0];
      if (r.missing && rel(r.missing) === path) return null;
      if (r.found && rel(r.found.name) === path && typeof r.found.updateTime === 'string') return { data: fromFields(r.found.fields), updateTime: r.found.updateTime };
      throw new BackendUnavailable('batchGet: result does not name the requested document');
    },
    async commit(transaction, writes) { return call('commit', { writes, transaction }); },
    async rollback(transaction) { try { await call('rollback', { transaction }); } catch { /* the transaction is already gone (aborted) or the backend is down */ } },
  };
}
