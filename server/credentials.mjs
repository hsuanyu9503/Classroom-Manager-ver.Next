/** OAuth access tokens for the API's OWN server-side access in firebase mode (Firestore, Identity Toolkit admin).
 *  Never a key file in the repository, never logged:
 *   - adc:      the owner's Application Default Credentials from `gcloud auth application-default login`
 *               (type authorized_user; a service-account KEY file is refused on purpose — no private keys)
 *   - metadata: the runtime's attached service account (e.g. Cloud Run's metadata server)
 *  Tokens are cached in memory until shortly before they expire. */
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

export function adcPath(env = process.env, platform = process.platform) {
  if (env.GOOGLE_APPLICATION_CREDENTIALS) return env.GOOGLE_APPLICATION_CREDENTIALS;
  return platform === 'win32' ? path.join(env.APPDATA || '', 'gcloud', 'application_default_credentials.json') : path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
}

/** @param kind 'adc' | 'metadata'; @param deps.fetch / deps.readFile / deps.now injectable for tests
 *  → { kind, userProject: boolean, accessToken: () => Promise<string> } */
export function createAccessTokenSource(kind, { env = process.env, fetch: f = fetch, readFile = (p) => readFileSync(p, 'utf8'), now = () => Date.now() } = {}) {
  let cached = null;
  const fresh = () => cached && cached.expiresAt - 60000 > now();
  if (kind === 'adc') {
    const file = adcPath(env);
    let adc;
    try { adc = JSON.parse(readFile(file)); } catch { throw new Error(`no Application Default Credentials at ${file} (run: gcloud auth application-default login)`); }
    if (adc.type !== 'authorized_user') throw new Error(`ADC type ${adc.type} refused: use gcloud auth application-default login (no service-account key files)`);
    for (const k of ['client_id', 'client_secret', 'refresh_token']) if (typeof adc[k] !== 'string' || !adc[k]) throw new Error(`ADC file is missing ${k}`);
    return {
      kind, userProject: true,
      async accessToken() {
        if (fresh()) return cached.token;
        const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: adc.client_id, client_secret: adc.client_secret, refresh_token: adc.refresh_token });
        const r = await f(OAUTH_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, redirect: 'error', signal: AbortSignal.timeout(10000) });
        const j = await r.json().catch(() => null);
        if (r.status !== 200 || typeof j?.access_token !== 'string') throw new Error(`ADC token refresh failed (${r.status})`);
        cached = { token: j.access_token, expiresAt: now() + (Number(j.expires_in) || 300) * 1000 };
        return cached.token;
      },
    };
  }
  if (kind === 'metadata') {
    return {
      kind, userProject: false,
      async accessToken() {
        if (fresh()) return cached.token;
        const r = await f(METADATA_TOKEN_URL, { headers: { 'metadata-flavor': 'Google' }, redirect: 'error', signal: AbortSignal.timeout(5000) });
        const j = await r.json().catch(() => null);
        if (r.status !== 200 || typeof j?.access_token !== 'string') throw new Error(`metadata token failed (${r.status})`);
        cached = { token: j.access_token, expiresAt: now() + (Number(j.expires_in) || 300) * 1000 };
        return cached.token;
      },
    };
  }
  throw new Error(`unknown credential source ${kind}`);
}
