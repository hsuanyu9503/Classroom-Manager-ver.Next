#!/usr/bin/env node
/** Runs the site against a REAL (development) Firebase project on THIS computer (SPEC §12.6):
 *  the page + the controlled API on ONE local origin (http://localhost:18400), REAL Google sign-in.
 *    set CMN_API_MODE=firebase, CMN_FIREBASE_PROJECT_ID, CMN_CONFIRM_FIREBASE_PROJECT, CMN_GCP_CREDENTIALS=adc
 *    node server/main.mjs
 *  Needs dev/firebase-web-config.json (public Web app settings, git-ignored) and the owner's ADC
 *  (`gcloud auth application-default login`). Loopback only; this is NOT a deployment. Fictional data only.
 *  The emulator is run with dev/launcher.mjs instead. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from './config.mjs';
import { createAccessTokenSource } from './credentials.mjs';
import { createFirebaseBackend } from './backend.mjs';
import { createApi } from './api.mjs';
import { createWebProxy } from '../dev/proxy.mjs';
import { STATIC_FILES, WEB_ROOT, LOGIN_SCENARIO } from '../dev/world.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const API_PORT = 18310; export const SITE_PORT = 18400;

export function loadWebConfig(projectId, file = path.join(ROOT, 'dev', 'firebase-web-config.json')) {
  let c; try { c = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error(`missing ${path.relative(ROOT, file)} (copy dev/firebase-web-config.example.json and fill in the Web app settings)`); }
  for (const k of ['apiKey', 'authDomain', 'projectId', 'appId']) if (typeof c[k] !== 'string' || !c[k] || c[k].startsWith('<')) throw new Error(`firebase-web-config.json: ${k} is not filled in`);
  if (c.projectId !== projectId) throw new Error(`firebase-web-config.json is for ${c.projectId}, not ${projectId}`);
  return { apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId, appId: c.appId };
}

async function main() {
  const cfg = resolveConfig(process.env);
  if (cfg.mode !== 'firebase') throw new Error('server/main.mjs is for CMN_API_MODE=firebase; use dev/launcher.mjs for the emulator');
  const web = loadWebConfig(cfg.projectId);
  const tokens = createAccessTokenSource(cfg.credentials);
  await tokens.accessToken();   // fail early if the API's own credentials are not usable (nothing is printed)
  const api = createApi({ port: API_PORT, backend: createFirebaseBackend({ projectId: cfg.projectId, tokens }) });
  await api.listen();
  const site = createWebProxy({ port: SITE_PORT, upstream: `http://127.0.0.1:${API_PORT}`, scenario: LOGIN_SCENARIO, webRoot: WEB_ROOT, staticFiles: STATIC_FILES, login: { real: true, firebase: web } });
  await site.listen();
  console.log(`\nREAL Firebase project ${cfg.projectId} (development, fictional data only)\nOpen: http://localhost:${SITE_PORT}/   (use localhost: it is an authorized domain by default)\nStop: Ctrl+C\n`);
  const stop = async () => { await site.close(); await api.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`REFUSED: ${e.message}`); process.exit(2); });
