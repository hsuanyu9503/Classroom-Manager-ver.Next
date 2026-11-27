#!/usr/bin/env node
/** Builds web/vendor/firebase-auth.js from the pinned `firebase` devDependency (package-lock.json) with esbuild.
 *    node scripts/build-vendor.mjs            write the bundle
 *    node scripts/build-vendor.mjs --check    exit 1 if the committed bundle differs from a fresh build
 *  The output is deterministic for the same lockfile, so the committed file can be verified by anyone. */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'web', 'vendor', 'firebase-auth.js');
const version = JSON.parse(readFileSync(path.join(ROOT, 'node_modules', 'firebase', 'package.json'), 'utf8')).version;
const r = await build({
  entryPoints: [path.join(ROOT, 'web-src', 'firebase-entry.mjs')], bundle: true, format: 'esm', platform: 'browser', target: 'es2020',
  minify: true, legalComments: 'eof', write: false, logLevel: 'silent',
  banner: { js: `/* Firebase JS SDK ${version} (Authentication only), bundled by scripts/build-vendor.mjs. Apache-2.0, see the end of this file. */` },
});
const text = r.outputFiles[0].text;
const sha = (s) => createHash('sha256').update(s).digest('hex');
if (process.argv.includes('--check')) {
  let cur = ''; try { cur = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
  console.log(`firebase ${version}: committed ${sha(cur).slice(0, 16)}  fresh ${sha(text).slice(0, 16)}`);
  process.exit(cur === text ? 0 : 1);
}
writeFileSync(OUT, text);
console.log(`wrote ${path.relative(ROOT, OUT)} (firebase ${version}, ${text.length} bytes, sha256 ${sha(text).slice(0, 16)})`);
