/** The fixed upstream (SPEC §3「對接的 API 版本」): class-management-next at PINNED_COMMIT, clean poc/stage2.
 *  Every check fails closed; nothing here modifies the upstream checkout. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PINNED_COMMIT = '1e20989ea6393c12dd18e11db617873c297a9f4a';
export const WEB_PORT = 18400;
/** Upstream service ports (emulators + back/api/front proxies) and the web proxy; all must be closed before start. */
export const UPSTREAM_PORTS = Object.freeze([8080, 9099, 4400, 4500, 9150, 18300, 18301, 18302, 18305]);

export class UpstreamError extends Error {}

/** → { root, stage2, firebaseJs } or throws UpstreamError with the reason. */
export function checkUpstream(root) {
  if (!root || !path.isAbsolute(root) || !existsSync(path.join(root, '.git'))) throw new UpstreamError(`upstream checkout not found: ${root}`);
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
  const head = git('rev-parse', 'HEAD');
  if (head !== PINNED_COMMIT) throw new UpstreamError(`upstream HEAD is ${head}, expected the pinned ${PINNED_COMMIT}`);
  const dirty = git('status', '--porcelain', '--', 'poc/stage2');
  if (dirty) throw new UpstreamError(`upstream poc/stage2 has uncommitted changes:\n${dirty}`);
  const stage2 = path.join(root, 'poc', 'stage2');
  const firebaseJs = path.join(stage2, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  if (!existsSync(firebaseJs)) throw new UpstreamError(`firebase-tools not installed in ${stage2} (run npm ci there)`);
  return { root, stage2, firebaseJs };
}

/** Imports an upstream module by its path below poc/stage2 (the upstream code is used, never copied). */
export const importUpstream = (stage2, rel) => import(pathToFileURL(path.join(stage2, rel)).href);

/** Every port must be confirmed closed (ECONNREFUSED); anything else is a hard stop. */
export async function requirePortsClosed(stage2, ports) {
  const { portState } = await importUpstream(stage2, 'src/port-state.mjs');
  const bad = [];
  for (const p of ports) { const s = await portState(p); if (s.state !== 'closed') bad.push(`${p}=${s.state}`); }
  if (bad.length) throw new UpstreamError(`ports not confirmed closed: ${bad.join(', ')}`);
}
