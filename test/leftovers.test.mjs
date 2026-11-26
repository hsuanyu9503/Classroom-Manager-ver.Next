/** WEB3-REV-002: ownership is proven by the full command line, never by a process name or a port alone. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../dev/leftovers.mjs';

const L = { stage2: '/home/u/cmn-1e20989/poc/stage2', siteRoot: '/home/u/site', projectId: 'demo-cmn-s2b2', win: false };
const W = { stage2: 'C:\\cmn\\cmn-1e20989\\poc\\stage2', siteRoot: 'C:\\cmn\\Classroom-Manager-ver.Next', projectId: 'demo-cmn-s2b2', win: true };
const fsJava = (rules, project = 'demo-cmn-s2b2') => `java -Dx=1 -jar /root/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar --host 127.0.0.1 --port 8080 --websocket_port 9150 --project_id ${project} --rules ${rules} --single_project_mode true`;

test('the Firestore emulator of THIS upstream checkout is OWNED', () => {
  assert.equal(classify({ name: 'java', cmd: fsJava('/home/u/cmn-1e20989/poc/stage2/firestore.rules') }, L).verdict, 'OWNED');
});
test('Windows: same, with backslashes and different letter case', () => {
  const cmd = '"C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe" -jar C:\\Users\\a\\.cache\\firebase\\emulators\\cloud-firestore-emulator-v1.22.0.jar --port 8080 --project_id demo-cmn-s2b2 --rules C:\\CMN\\cmn-1e20989\\poc\\stage2\\firestore.rules';
  assert.equal(classify({ name: 'java.exe', cmd }, W).verdict, 'OWNED');
});
test('any other java on 8080 / 9150 is NOT_OWNED (another Java dev service)', () => {
  assert.equal(classify({ name: 'java', cmd: 'java -jar /opt/app/server.jar --server.port=8080' }, L).verdict, 'NOT_OWNED');
});
test('a Firestore emulator of ANOTHER checkout or project is NOT_OWNED', () => {
  assert.equal(classify({ name: 'java', cmd: fsJava('/home/u/other-project/firestore.rules') }, L).verdict, 'NOT_OWNED');
  assert.equal(classify({ name: 'java', cmd: fsJava('/home/u/cmn-1e20989/poc/stage2/firestore.rules', 'demo-other') }, L).verdict, 'NOT_OWNED');
  assert.equal(classify({ name: 'java', cmd: fsJava('/home/u/cmn-1e20989/poc/stage2/firestore.rules', 'demo-cmn-s2b2-x').replace('--rules', '--rulesX') }, L).verdict, 'NOT_OWNED');
});
test('unreadable command line → NOT_OWNED', () => {
  assert.equal(classify({ name: 'java', cmd: null }, L).verdict, 'NOT_OWNED');
});
test('node: firebase of this upstream / stack of this site are OWNED; any other node is NOT_OWNED', () => {
  assert.equal(classify({ name: 'node', cmd: `/usr/bin/node ${L.stage2}/node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only auth,firestore --project demo-cmn-s2b2 node "/home/u/site/dev/stack.mjs"` }, L).role, 'firebase');
  assert.equal(classify({ name: 'node', cmd: 'node /home/u/site/dev/stack.mjs' }, L).role, 'stack');
  assert.equal(classify({ name: 'node', cmd: 'node /home/u/other/server.js' }, L).verdict, 'NOT_OWNED');
  assert.equal(classify({ name: 'node', cmd: 'node /home/u/other/node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project demo-cmn-s2b2' }, L).verdict, 'NOT_OWNED');
});
test('other process names are NOT_OWNED', () => {
  assert.equal(classify({ name: 'nginx', cmd: 'nginx -g daemon off;' }, L).verdict, 'NOT_OWNED');
});
