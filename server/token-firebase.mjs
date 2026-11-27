/** Firebase ID token verification for a REAL project (firebase mode). Mirrors what the Admin SDK's
 *  verifyIdToken(token, checkRevoked = true) does, without the SDK:
 *   1. header: alg RS256, kid present; signature verified with Google's published securetoken certificate for kid;
 *   2. claims: iss https://securetoken.google.com/<project>, aud <project>, sub = user_id (1–128 [A-Za-z0-9]),
 *      iat / exp integer NumericDate, exp > now, iat ≤ now + skew, auth_time ≤ iat;
 *   3. account state from Identity Toolkit (admin, the API's own credentials): exists, same uid, not disabled,
 *      and the sign-in is not older than validSince (revoked sessions; like the Admin SDK, auth_time is compared,
 *      or iat when auth_time is absent).
 *  Any failure → { ok: false, reason }. The emulator mode keeps the upstream verifyEmulatorIdToken unchanged. */
import { createVerify, X509Certificate } from 'node:crypto';
import { isNumericDate } from './upstream/poc/stage2/src/time-validate.mjs';

export const SECURETOKEN_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
export const MAX_FUTURE_SKEW_SEC = 60;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const UID_RE = /^[A-Za-z0-9]{1,128}$/;
const fail = (reason) => ({ ok: false, reason });
function decodeJson(seg) {
  if (!B64URL_RE.test(seg)) return null;
  try { const v = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

/** Google's certificates, cached per Cache-Control max-age. fetchJson(url) → { status, json, maxAgeSec } */
export function createCertCache({ url = SECURETOKEN_CERTS_URL, fetchJson, now = () => Date.now() }) {
  let cache = null;
  return async function getCerts() {
    if (cache && cache.until > now()) return cache.certs;
    const r = await fetchJson(url);
    if (r.status !== 200 || !r.json || typeof r.json !== 'object') return null;
    cache = { certs: r.json, until: now() + Math.min(Math.max(r.maxAgeSec || 0, 0), 6 * 3600) * 1000 };
    return cache.certs;
  };
}

/** Parse + signature + claims, no account lookup. */
export async function checkFirebaseTokenClaims(token, { projectId, nowSec, getCerts }) {
  if (typeof token !== 'string' || token.length > 8192) return fail('TOKEN_MALFORMED');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => B64URL_RE.test(p))) return fail('TOKEN_MALFORMED');
  const header = decodeJson(parts[0]); const payload = decodeJson(parts[1]);
  if (!header || !payload) return fail('TOKEN_MALFORMED');
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return fail('TOKEN_BAD_ALGORITHM');
  const certs = await getCerts();
  if (!certs) return fail('AUTH_UNAVAILABLE');
  const pem = Object.hasOwn(certs, header.kid) ? certs[header.kid] : null;
  if (typeof pem !== 'string') return fail('TOKEN_UNKNOWN_KEY');
  let ok = false;
  try {
    const v = createVerify('RSA-SHA256'); v.update(`${parts[0]}.${parts[1]}`);
    ok = v.verify(new X509Certificate(pem).publicKey, Buffer.from(parts[2], 'base64url'));
  } catch { ok = false; }
  if (!ok) return fail('TOKEN_BAD_SIGNATURE');
  if (payload.iss !== `https://securetoken.google.com/${projectId}` || payload.aud !== projectId) return fail('TOKEN_WRONG_AUDIENCE');
  if (typeof payload.sub !== 'string' || !UID_RE.test(payload.sub) || payload.user_id !== payload.sub) return fail('TOKEN_BAD_SUBJECT');
  if (!isNumericDate(payload.iat) || !isNumericDate(payload.exp)) return fail('TOKEN_BAD_TIME');
  if (payload.auth_time !== undefined && (!isNumericDate(payload.auth_time) || payload.auth_time > payload.iat)) return fail('TOKEN_BAD_TIME');
  if (payload.exp <= nowSec) return fail('TOKEN_EXPIRED');
  if (payload.iat > nowSec + MAX_FUTURE_SKEW_SEC) return fail('TOKEN_FROM_FUTURE');
  if (payload.exp <= payload.iat) return fail('TOKEN_BAD_TIME');
  return { ok: true, claims: { authUid: payload.sub, iat: payload.iat, exp: payload.exp, authTime: payload.auth_time ?? payload.iat } };
}

/** Full verification. lookupUser(uid) → { status, json } of Identity Toolkit accounts:lookup (admin). */
export async function verifyFirebaseIdToken(token, { projectId, nowSec, getCerts, lookupUser }) {
  const c = await checkFirebaseTokenClaims(token, { projectId, nowSec, getCerts });
  if (!c.ok) return c;
  const r = await lookupUser(c.claims.authUid);
  if (r.status === 0 || r.status >= 500) return fail('AUTH_UNAVAILABLE');
  const users = r.json?.users;
  if (r.status !== 200 || !Array.isArray(users) || users.length !== 1 || users[0].localId !== c.claims.authUid) return fail('TOKEN_USER_NOT_FOUND');
  if (users[0].disabled === true) return fail('TOKEN_USER_DISABLED');
  const validSince = Number(users[0].validSince);
  if (Number.isFinite(validSince) && c.claims.authTime < validSince) return fail('TOKEN_REVOKED');
  // the claims handed to authorization are the upstream shape { authUid, iat, exp }
  return { ok: true, claims: { authUid: c.claims.authUid, iat: c.claims.iat, exp: c.claims.exp } };
}
