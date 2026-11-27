/** Which backend the controlled API talks to — chosen ONLY from explicit environment settings, fail closed.
 *
 *  CMN_API_MODE=emulator  the local Firebase Emulator Suite (demo- project, loopback hosts; upstream guard)
 *  CMN_API_MODE=firebase  a REAL Firebase project (development project, fictional data — SPEC §12):
 *    CMN_FIREBASE_PROJECT_ID   the project id (never demo-)
 *    CMN_CONFIRM_FIREBASE_PROJECT  must repeat the same id: a typo or a copied shell line cannot hit another project
 *    CMN_GCP_CREDENTIALS       adc (the owner's `gcloud auth application-default login`, authorized_user only)
 *                              | metadata (the runtime's service account, e.g. Cloud Run)
 *    and NO *_EMULATOR_HOST variable may be set (it would silently redirect SDKs / tools to an emulator).
 *  Nothing here reads a key file or a secret; credentials are obtained at run time (server/credentials.mjs). */
import { assertLocalConfig } from './upstream/poc/stage2/src/local-guard.mjs';

export class ConfigError extends Error { constructor(m) { super(m); this.name = 'ConfigError'; } }
export const EMULATOR_ENV = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'PUBSUB_EMULATOR_HOST'];
const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** → { mode: 'emulator', projectId, firestoreOrigin, authOrigin } | { mode: 'firebase', projectId, credentials } */
export function resolveConfig(env = process.env, { firebaseJsonPath = null } = {}) {
  const mode = env.CMN_API_MODE;
  if (mode === 'emulator') {
    const cfg = assertLocalConfig(env, { firebaseJsonPath });   // upstream guard: demo- project, loopback emulator hosts only
    return Object.freeze({ mode, projectId: cfg.projectId, firestoreOrigin: cfg.firestore.origin, authOrigin: cfg.auth.origin });
  }
  if (mode === 'firebase') {
    const projectId = env.CMN_FIREBASE_PROJECT_ID;
    if (typeof projectId !== 'string' || !PROJECT_RE.test(projectId)) throw new ConfigError('CMN_FIREBASE_PROJECT_ID is missing or not a valid project id');
    if (projectId.startsWith('demo-')) throw new ConfigError('firebase mode never uses a demo- project (that is the emulator)');
    if (env.CMN_CONFIRM_FIREBASE_PROJECT !== projectId) throw new ConfigError('CMN_CONFIRM_FIREBASE_PROJECT must repeat CMN_FIREBASE_PROJECT_ID exactly');
    const set = EMULATOR_ENV.filter((k) => env[k] !== undefined && env[k] !== '');
    if (set.length) throw new ConfigError(`firebase mode refuses emulator settings: ${set.join(', ')}`);
    for (const k of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) if (env[k] && env[k] !== projectId) throw new ConfigError(`${k}=${env[k]} does not match ${projectId}`);
    const credentials = env.CMN_GCP_CREDENTIALS;
    if (!['adc', 'metadata'].includes(credentials)) throw new ConfigError('CMN_GCP_CREDENTIALS must be adc or metadata');
    return Object.freeze({ mode, projectId, credentials });
  }
  throw new ConfigError('CMN_API_MODE must be emulator or firebase');
}
