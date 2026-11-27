/** The only place that knows WHERE the API's data lives and HOW the API authenticates to it.
 *  emulator: loopback Emulator (normally through the upstream BACK trace proxy), owner = admin-equivalent,
 *            ID tokens checked by the upstream verifyEmulatorIdToken (unchanged).
 *  firebase: Google endpoints for ONE fixed project, the API's own OAuth access token (credentials.mjs),
 *            ID tokens checked by token-firebase.mjs (signature + claims + account state).
 *  Every outgoing URL is checked against the mode's allow-list before the request is sent. */
import { assertLoopbackUrl } from './upstream/poc/stage2/src/local-guard.mjs';
import { EMULATOR_OWNER } from './upstream/poc/stage2/src/emu-client.mjs';
import { verifyEmulatorIdToken } from './upstream/poc/stage2/src/api/token.mjs';
import { verifyFirebaseIdToken, createCertCache, SECURETOKEN_CERTS_URL } from './token-firebase.mjs';

export const GOOGLE_ENDPOINTS = Object.freeze({ firestore: 'https://firestore.googleapis.com', identityToolkit: 'https://identitytoolkit.googleapis.com', certs: SECURETOKEN_CERTS_URL });
const docsPrefix = (projectId) => `projects/${projectId}/databases/(default)/documents`;

/** @param o.origin the loopback origin of the Firestore + Auth emulators (normally the back trace proxy) */
export function createEmulatorBackend({ projectId, origin }) {
  if (!/^demo-/.test(projectId)) throw new Error('emulator backend: project must be a demo- project');
  assertLoopbackUrl(`${origin}/`);
  const docsBase = `${origin}/v1/${docsPrefix(projectId)}`;
  return Object.freeze({
    mode: 'emulator', projectId, docsPrefix: docsPrefix(projectId), docsBase,
    checkUrl: (url) => assertLoopbackUrl(url),
    headers: async () => ({ authorization: `Bearer ${EMULATOR_OWNER}` }),
    async verifyIdToken(token, { nowSec, traceHeaders = {} }) {
      const lookup = async (idToken) => {
        const url = `${origin}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=emulator-local`;
        assertLoopbackUrl(url);
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...traceHeaders }, body: JSON.stringify({ idToken }), redirect: 'error', signal: AbortSignal.timeout(5000) });
          return { status: r.status, json: await r.json().catch(() => null) };
        } catch { return { status: 0, json: null }; }
      };
      return verifyEmulatorIdToken(token, { projectId, nowSec, lookup });
    },
  });
}

/** @param o.tokens     credentials.mjs source ({ accessToken(), userProject })
 *  @param o.endpoints  TESTS ONLY (integration test against emulators with test-minted RS256 tokens); the server
 *                      entry point never passes it, so a real run always uses GOOGLE_ENDPOINTS. */
export function createFirebaseBackend({ projectId, tokens, endpoints = GOOGLE_ENDPOINTS }) {
  const ep = { ...GOOGLE_ENDPOINTS, ...endpoints };
  const docsBase = `${ep.firestore}/v1/${docsPrefix(projectId)}`;
  const allowed = [`${docsBase}/`, `${docsBase}:`, `${ep.identityToolkit}/v1/projects/${projectId}/accounts:lookup`];
  const checkUrl = (url) => { if (!allowed.some((a) => url === a || url.startsWith(a))) throw new Error(`firebase backend: URL not allowed: ${url.slice(0, 120)}`); };
  const headers = async () => ({ authorization: `Bearer ${await tokens.accessToken()}`, ...(tokens.userProject ? { 'x-goog-user-project': projectId } : {}) });
  const fetchJson = async (url) => {
    try {
      const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
      const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
      return { status: r.status, json: await r.json().catch(() => null), maxAgeSec: m ? Number(m[1]) : 0 };
    } catch { return { status: 0, json: null, maxAgeSec: 0 }; }
  };
  const getCerts = createCertCache({ url: ep.certs, fetchJson });
  return Object.freeze({
    mode: 'firebase', projectId, docsPrefix: docsPrefix(projectId), docsBase, checkUrl, headers,
    async verifyIdToken(token, { nowSec }) {
      const lookupUser = async (uid) => {
        const url = `${ep.identityToolkit}/v1/projects/${projectId}/accounts:lookup`;
        checkUrl(url);
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(await headers()) }, body: JSON.stringify({ localId: [uid] }), redirect: 'error', signal: AbortSignal.timeout(5000) });
          return { status: r.status, json: await r.json().catch(() => null) };
        } catch { return { status: 0, json: null }; }
      };
      return verifyFirebaseIdToken(token, { projectId, nowSec, getCerts, lookupUser });
    },
  });
}
