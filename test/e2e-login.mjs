/** Google sign-in E2E (SPEC §11) on the REAL Auth/Firestore emulators and the PINNED upstream API (1e20989).
 *  Runs only inside `firebase emulators:exec`:  node test/run-e2e.mjs --upstream <path> --script e2e-login
 *  SIMULATED sign-in: the Auth Emulator's Google provider with fictional accounts (dev/login-identities.json). This is
 *  NOT a real Google sign-in. Every check is judged from the page AND from upstream state (audit log: which uid made
 *  each request and whether it was allowed; revisions; the front trace), never from the page's own claim.
 *  A test-only fault proxy (port 18401) is used for the lost-response cases. Fictional data only. */
import http from 'node:http';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { openUpstream, startLogin } from '../dev/world.mjs';
import { createEmulatorBackend } from '../server/backend.mjs';
import { createAdmin } from '../server/admin.mjs';
import { WEB_PORT } from '../dev/upstream.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.env.W1_OUT || path.join(HERE, '..', 'test-results', `login-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}`);
mkdirSync(path.join(OUT, 'screens'), { recursive: true });
const FAULT_PORT = 18401;
const SC01 = 'teacher.sc01@example.test'; const A17 = 'teacher.a17@example.test'; const NOACC = 'no-access@example.test';
const LV_REV = /\/leaveRecords\/LV-007\/revisions\/[^/]+$/;

const up = await openUpstream(process.env.CMN_UPSTREAM_STAGE2);
const results = []; const log = (ok, name, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const fault = { dropCommit: 0 };
const faultServer = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${up.PORTS.front}${req.url}`, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json', ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) }, body: Buffer.concat(chunks) });
      const text = await r.text();
      if (req.url === '/v1/commit' && fault.dropCommit > 0) { fault.dropCommit -= 1; return req.socket.destroy(); }   // committed upstream, response lost
      res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(text);
    } catch { req.socket.destroy(); }
  });
});
await new Promise((r) => faultServer.listen(FAULT_PORT, '127.0.0.1', r));
const browser = await chromium.launch();
let current = null;
async function world(viaFault = false) {
  if (current) await current.stop();
  fault.dropCommit = 0;
  current = await startLogin(up, { webPort: WEB_PORT, upstreamOverride: viaFault ? `http://127.0.0.1:${FAULT_PORT}` : null });
  return current;
}
const state = async () => (await up.h.exportState()).docs;
const revisions = (docs) => Object.keys(docs).filter((k) => LV_REV.test(k));
const audits = (docs) => Object.entries(docs).filter(([k]) => /\/auditLog\/[^/]+$|^auditLogUnscoped\/[^/]+$/.test(k)).map(([, v]) => v);
const frontLines = (s) => readFileSync(path.join(s.traceDir, 'trace-front.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const frontApi = (s) => frontLines(s).filter((e) => ['/v1/read', '/v1/commit', '/v1/receipt'].includes(e.path));
const frontCommits = (s) => frontApi(s).filter((e) => e.path === '/v1/commit');
const opIdsOf = (s) => new Set(frontCommits(s).map((e) => e.requestBody?.command?.operationId).filter(Boolean));

async function open(s, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());   // the logout confirmation (overridden per test when needed)
  await page.goto(s.url);
  await page.waitForFunction(() => ['login', 'noAccess'].includes(document.getElementById('gate').dataset.kind) || !document.getElementById('p1').hidden, null, { timeout: 30000 });
  return { ctx, page };
}
const gateKind = (page) => page.evaluate(() => (document.getElementById('gate').hidden ? null : document.getElementById('gate').dataset.kind));
const mainText = (page) => page.locator('main').innerText();
async function signInAs(page, email) {
  await page.click('#loginButton'); await page.locator('#accountDialog[open]').waitFor();
  if (email === 'new') await page.locator('#accountList button.acc-new').click();
  else await page.locator('#accountList button', { hasText: email }).click();
  // signed in (account bar), then either the no-access screen or the class data — never the stale sign-in screen
  await page.waitForFunction(() => { if (document.getElementById('authBar').hidden) return false; const g = document.getElementById('gate'); return (!g.hidden && g.dataset.kind === 'noAccess') || (!document.getElementById('p1').hidden && document.querySelector('#p1Body table, #p1Body .denied')); }, null, { timeout: 30000 });
}
const waitLeave = (page) => page.locator('#p2Body dl').waitFor();
const waitState = (page, ...st) => page.waitForFunction((x) => x.includes(document.getElementById('statusRegion').dataset.state), st, { timeout: 30000 });
async function confirmRevision(page) { await page.click('#reviseButton'); await page.locator('#confirmDialog[open]').waitFor(); await page.click('#confirmButton'); }
const uidOf = (s, email) => s.identities[email].uid;
/** the signed-in user's own token, read from the SDK's per-tab session storage — TEST ONLY, to probe the API directly */
const ownToken = (page) => page.evaluate(() => { for (let i = 0; i < sessionStorage.length; i += 1) { const k = sessionStorage.key(i); if (k.startsWith('firebase:authUser:')) return JSON.parse(sessionStorage.getItem(k)).stsTokenManager.accessToken; } return null; });
/** audit records are read from upstream state; poll briefly until the expected ones are listed */
async function waitAudits(pred, ms = 8000) {
  const t0 = Date.now(); let docs = await state();
  while (Date.now() - t0 < ms && !audits(docs).some(pred)) { await new Promise((r) => setTimeout(r, 300)); docs = await state(); }
  return docs;
}
/** class data left ANYWHERE in the DOM (hidden elements included, not just visible text) */
const domLeak = (page) => page.evaluate(() => {
  const m = document.querySelector('main').textContent;
  const out = [];
  if (document.querySelector('#p1Body table, #p1Body dl')) out.push('roster');
  if (document.querySelector('#p2Body dl')) out.push('leave');
  if (document.getElementById('statusRegion').textContent.trim()) out.push('result');
  for (const id of ['LV-007', 'CLASS-606', 'WS-SC01', 'WS-A17', 'AS-SC01', 'AS-A17']) if (m.includes(id)) out.push(id);
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(m)) out.push('operationId');
  return out;
});
const hasData = (t) => ['LV-007', 'SICK-LEAVE', '合計', '操作編號', '收據'].filter((m) => t.includes(m));

try {
  /* ---------- L1 not signed in: the login gate, NO API request at all */
  {
    const s = await world(); const { ctx, page } = await open(s);
    await page.waitForTimeout(800);
    const t = await mainText(page);
    const leak1 = await domLeak(page);
    log(await gateKind(page) === 'login' && hasData(t).length === 0 && leak1.length === 0 && frontApi(s).length === 0 && await page.locator('#authBar').isHidden(),
      'L1 not signed in: 「請先登入」, no class data in the page, ZERO API requests reached the upstream', `api=${frontApi(s).length} data=${hasData(t)}`);
    await page.screenshot({ path: path.join(OUT, 'screens', 'L1-signed-out-1440.png'), fullPage: true });
    /* L2 cancel */
    await page.click('#loginButton'); await page.locator('#accountDialog[open]').waitFor();
    await page.screenshot({ path: path.join(OUT, 'screens', 'L2-chooser-1440.png') });
    await page.click('#accountCancel');
    await page.locator('#loginNotice').waitFor();
    const n2 = await page.locator('#loginNotice').innerText();
    log(n2.includes('已取消登入') && await gateKind(page) === 'login' && frontApi(s).length === 0, 'L2 sign-in cancelled: 「已取消登入，沒有任何變更」, still signed out, no API request', n2);
    /* L3 failure: the Auth Emulator is unreachable from the page */
    await page.route('http://127.0.0.1:9099/**', (r) => r.abort());
    await page.click('#loginButton'); await page.locator('#accountDialog[open]').waitFor();
    await page.locator('#accountList button', { hasText: SC01 }).click();
    await page.waitForFunction(() => document.getElementById('loginNotice')?.innerText.includes('無法連線'), null, { timeout: 30000 }).catch(() => {});
    const n3 = await page.locator('#loginNotice').innerText().catch(() => '');
    await page.unroute('http://127.0.0.1:9099/**');
    log(n3.includes('無法連線到登入服務') && await gateKind(page) === 'login' && frontApi(s).length === 0 && !(await page.locator('#loginButton').isDisabled()), 'L3 sign-in fails (auth service unreachable): clear message, button usable again, still signed out, no API request', n3);
    await ctx.close();
  }

  /* ---------- L4 signed in WITHOUT a binding (configured no-access account, and a brand-new account) */
  {
    const s = await world();
    for (const who of [NOACC, 'new']) {
      const { ctx, page } = await open(s);
      await signInAs(page, who);
      const t = await mainText(page);
      const known = new Set([...Object.values(s.identities).map((v) => v.uid), ...Object.values(s.users).map((u) => u.uid)]);
      const docs = await waitAudits((a) => (who === NOACC ? a.authUid === uidOf(s, NOACC) : !known.has(a.authUid)) && a.reasonCode === 'BINDING_NOT_FOUND');
      const mine = who === NOACC ? audits(docs).filter((a) => a.authUid === uidOf(s, NOACC)) : audits(docs).filter((a) => !Object.values(s.identities).some((v) => v.uid === a.authUid) && !Object.values(s.users).some((u) => u.uid === a.authUid));
      const leak4 = await domLeak(page);
      const shownUid = await page.locator('#gateUid').innerText().catch(() => '');
      log(await gateKind(page) === 'noAccess' && t.includes('尚未取得班級存取權') && hasData(t).length === 0 && leak4.length === 0 && mine.length >= 2 && shownUid.length > 0 && mine.every((a) => a.authUid === shownUid) && mine.every((a) => a.decision === 'deny' && a.reasonCode === 'BINDING_NOT_FOUND'),
        `L4 signed in without a binding (${who === 'new' ? 'brand-new emulator Google account' : NOACC}): 「尚未取得班級存取權」, no class data; every request was made with THIS uid and denied BINDING_NOT_FOUND (no auto-grant)`, `gate=${await gateKind(page)} text=${t.includes('尚未取得班級存取權')} data=${hasData(t)} deny=${mine.every((a) => a.decision === 'deny')} audits=${mine.length} ${[...new Set(mine.map((a) => a.reasonCode))]} allAudits=${JSON.stringify(audits(docs).slice(-3).map((a) => [a.authUid, a.reasonCode]))} keys=${Object.keys(docs).filter((k) => /audit/i.test(k)).slice(-2)}`);
      if (who === NOACC) await page.screenshot({ path: path.join(OUT, 'screens', 'L4-no-access-1440.png'), fullPage: true });
      await ctx.close();
    }
  }

  /* ---------- L5 SC01 teacher: only SC01; another workspace refused even when asked directly; L6 reload keeps the sign-in */
  {
    const s = await world(); const { ctx, page } = await open(s);
    await signInAs(page, SC01); await waitLeave(page);
    const t = await mainText(page); const tok = await ownToken(page);
    const direct = await page.evaluate(async (token) => {
      const post = async (body) => (await fetch('/v1/read', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })).status;
      return {
        a17: await post({ op: 'attendanceSession.read', target: { sessionId: 'AS-A17-20261117-DAILY' }, claimedScope: { workspaceId: 'WS-A17', classId: 'CLASS-606-A17' } }),
        a17claimSC01: await post({ op: 'attendanceSession.read', target: { sessionId: 'AS-A17-20261117-DAILY' }, claimedScope: { workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01' } }),
        sc01: await post({ op: 'attendanceSession.read', target: { sessionId: 'AS-SC01-20261116-DAILY' }, claimedScope: { workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01' } }),
      };
    }, tok);
    const docs = await state();
    const allowed = audits(docs).filter((a) => a.decision === 'allow');
    const classShown = await page.locator('#classOnly').innerText();
    log(t.includes('LV-007') && t.includes('上午') && !t.includes('2026-11-17') && classShown.includes('CLASS-606-SC01') && await page.locator('#classSelect').isHidden() && direct.a17 === 403 && direct.a17claimSC01 === 403 && direct.sc01 === 200
      && allowed.length > 0 && allowed.every((a) => a.authUid === uidOf(s, SC01) && a.principalId === 'ACTOR-SC01-TEACHER') && (await page.locator('#authUser').innerText()).includes(SC01),
      'L5 SC01 teacher sees ONLY SC01 (LV-007); A17 is refused even when asked directly or with a forged claimed scope; every allowed request was made with the user\'s own Google uid', JSON.stringify(direct));
    await page.screenshot({ path: path.join(OUT, 'screens', 'L5-signed-in-sc01-1440.png'), fullPage: true });
    await page.reload(); await page.waitForFunction(() => !document.getElementById('p1').hidden && document.querySelector('#p2Body dl'), null, { timeout: 30000 });
    log((await mainText(page)).includes('LV-007') && (await page.locator('#authUser').innerText()).includes(SC01), 'L6 reload: the sign-in is restored by the SDK (this tab only) and the data is read again');
    /* L7 the W1 correction with the user's own token */
    await confirmRevision(page); await waitState(page, 'done'); await page.waitForFunction(() => document.getElementById('p2Body').innerText.includes('v6'));
    const d7 = await state(); const commitAudit = audits(d7).filter((a) => a.action === 'leaveRecord.revise' || a.operationId);
    log(revisions(d7).length === 1 && commitAudit.length >= 1 && commitAudit.every((a) => a.authUid === uidOf(s, SC01)) && frontCommits(s).length === 1,
      'L7 AM→全天 succeeds (v6) signed in; the commit was authorized for the signed-in Google uid; one revision', `commits=${frontCommits(s).length} revisions=${revisions(d7).length}`);
    await ctx.close();
  }

  /* ---------- L8 two tabs, both signed in as SC01 → one 完成, one 衝突; re-read sends nothing */
  {
    const s = await world(); const a = await open(s); const b = await open(s);
    await signInAs(a.page, SC01); await signInAs(b.page, SC01); await waitLeave(a.page); await waitLeave(b.page);
    await confirmRevision(a.page); await waitState(a.page, 'done');
    await confirmRevision(b.page); await waitState(b.page, 'conflict');
    const c0 = frontCommits(s).length;
    await b.page.getByRole('button', { name: '重新讀取' }).click(); await b.page.waitForFunction(() => document.getElementById('p2Body').innerText.includes('v6'));
    await b.page.waitForTimeout(500);
    log(revisions(await state()).length === 1 && frontCommits(s).length === c0 && c0 === 2 && await b.page.locator('#reviseButton').isDisabled(), 'L8 two signed-in tabs: one 完成, one 衝突; after 重新讀取 nothing more is sent; one revision');
    await a.ctx.close(); await b.ctx.close();
  }

  /* ---------- L9 lost response, same user resends the SAME operation → original receipt */
  {
    const s = await world(true); const { ctx, page } = await open(s);
    await signInAs(page, SC01); await waitLeave(page);
    fault.dropCommit = 1; await confirmRevision(page); await waitState(page, 'unknown');
    await page.getByRole('button', { name: '重新送出同一操作' }).click(); await waitState(page, 'done');
    log(revisions(await state()).length === 1 && opIdsOf(s).size === 1 && frontCommits(s).length === 2, 'L9 signed in: response lost → 尚未確認 → 重新送出同一操作 → original receipt; one revision, one operationId');
    await ctx.close();
  }

  /* ---------- L10 logout with an unconfirmed operation; another account never sees / sends it; the owner gets it back */
  {
    const s = await world(true); const { ctx, page } = await open(s);
    await signInAs(page, SC01); await waitLeave(page);
    fault.dropCommit = 1; await confirmRevision(page); await waitState(page, 'unknown');
    const opId = [...opIdsOf(s)][0];
    // dismissing the confirmation keeps the user signed in
    page.removeAllListeners('dialog'); page.once('dialog', (d) => d.dismiss());
    await page.click('#logoutButton'); await page.waitForTimeout(500);
    const stillIn = await page.locator('#authBar').isVisible();
    let asked = null; page.once('dialog', (d) => { asked = d.message(); d.accept(); });
    await page.click('#logoutButton'); await page.waitForFunction(() => document.getElementById('gate').dataset.kind === 'login' && !document.getElementById('gate').hidden);
    const out = await mainText(page); const leakOut = await domLeak(page);
    const cAfterLogout = frontCommits(s).length; const apiAfterLogout = frontApi(s).length;
    await signInAs(page, NOACC);
    const other = await mainText(page); const leakOther = await domLeak(page);
    const parkedShown = await page.locator('#parkedNotice').isVisible();
    const receiptsByOther = audits(await state()).filter((a) => a.authUid === uidOf(s, NOACC) && (a.action === 'receipt.read' || a.operationId));
    await page.screenshot({ path: path.join(OUT, 'screens', 'L10-other-account-parked-1440.png'), fullPage: true });
    page.on('dialog', (d) => d.accept());
    await page.click('#logoutButton'); await page.waitForFunction(() => document.getElementById('gate').dataset.kind === 'login');
    await signInAs(page, SC01); await waitState(page, 'unknown');
    const back = await page.locator('#statusRegion').innerText();
    await page.getByRole('button', { name: '查詢結果' }).click(); await waitState(page, 'done');
    const done = await page.locator('#statusRegion').innerText();
    log(stillIn && asked && asked.includes('尚未確認') && leakOut.length === 0 && leakOther.length === 0 && hasData(out).length === 0 && !out.includes(opId) && hasData(other).length === 0 && !other.includes(opId) && parkedShown
      && frontCommits(s).length === cAfterLogout && receiptsByOther.length === 0 && back.includes(opId) && done.includes(opId) && opIdsOf(s).size === 1 && revisions(await state()).length === 1,
      'L10 logout with an unconfirmed operation: asked first (cancel keeps the sign-in); after logout and as ANOTHER account no data and no operation is shown, nothing is sent or queried for it (notice shown); the SAME account gets it back and 查詢結果 returns the original receipt',
      `stillIn=${stillIn} asked=${!!asked} leakOut=${leakOut} leakOther=${leakOther} outData=${hasData(out)} outOp=${out.includes(opId)} otherData=${hasData(other)} otherOp=${other.includes(opId)} parked=${parkedShown} commits ${cAfterLogout}→${frontCommits(s).length} api@logout=${apiAfterLogout} otherReceipts=${receiptsByOther.length} back=${back.includes(opId)} done=${done.includes(opId)} opIds=${opIdsOf(s).size}`);
    await ctx.close();
  }

  /* ---------- L11 account switch: SC01 → A17 leaves nothing of SC01 */
  {
    const s = await world(); const { ctx, page } = await open(s);
    await signInAs(page, SC01); await waitLeave(page);
    await page.click('#logoutButton'); await page.waitForFunction(() => document.getElementById('gate').dataset.kind === 'login');
    const between = await mainText(page); const leakBetween = await domLeak(page);
    await signInAs(page, A17); await page.locator('#p1Body table').waitFor();
    const t = await mainText(page); const rows = await page.locator('table.roster tbody tr').count();
    const leakA17 = (await domLeak(page)).filter((x) => !['roster', 'CLASS-606', 'WS-A17', 'AS-A17'].includes(x));   // A17's own data is expected
    log(hasData(between).length === 0 && leakBetween.length === 0 && leakA17.length === 0 && !t.includes('LV-007') && !t.includes('SICK-LEAVE') && await page.locator('#p2').isHidden() && rows === 15 && t.includes('2026-11-17') && (await page.locator('#authUser').innerText()).includes(A17),
      'L11 switching account (SC01 → A17): after logout nothing of SC01 remains in the DOM (hidden elements included); A17 sees only its own 15-row roster, no leave record', `rows=${rows} leakBetween=${leakBetween} leakA17=${leakA17}`);
    await ctx.close();
  }

  /* ---------- L12 the account is disabled while signed in → 「登入已失效」, data cleared */
  {
    const s = await world(); const { ctx, page } = await open(s);
    await signInAs(page, SC01); await waitLeave(page);
    await up.h.disableAuthUser(uidOf(s, SC01));
    await page.evaluate(() => document.getElementById('sessionSelect').dispatchEvent(new Event('change')));
    await page.waitForFunction(() => document.getElementById('gate').dataset.kind === 'login' && !document.getElementById('gate').hidden, null, { timeout: 30000 }).catch(() => {});
    const t = await mainText(page);
    const leak12 = await domLeak(page);
    log(t.includes('登入已失效') && hasData(t).length === 0 && leak12.length === 0 && await page.locator('#authBar').isHidden(), 'L12 account disabled while signed in: the next read is refused → the token refresh fails → 「登入已失效」, signed out, no data left', (await page.locator('#loginNotice').innerText().catch(() => '')));
    await ctx.close();
  }

  /* ---------- L13 the binding is revoked while signed in → 「尚未取得班級存取權」, data cleared */
  {
    const s = await world(); const { ctx, page } = await open(s);
    await signInAs(page, SC01); await waitLeave(page);
    await up.h.patchDoc(`authBindings/${uidOf(s, SC01)}`, { status: 'disabled' });
    await page.evaluate(() => document.getElementById('sessionSelect').dispatchEvent(new Event('change')));
    await page.waitForFunction(() => document.getElementById('gate').dataset.kind === 'noAccess' && !document.getElementById('gate').hidden, null, { timeout: 30000 });
    const t = await mainText(page);
    const leak13 = await domLeak(page);
    log(t.includes('尚未取得班級存取權') && hasData(t).length === 0 && leak13.length === 0 && await page.locator('#authBar').isVisible(), 'L13 binding revoked while signed in: the next read is refused → re-check → 「尚未取得班級存取權」, no data left, still signed in');
    await ctx.close();
  }

  /* ---------- L14 the client cannot give itself access: direct Firestore writes / reads with the user's own token are
     denied by THIS repository's firestore.rules (loaded into the emulator), and the API has no route to do it */
  {
    const s = await world();
    const rules = readFileSync(path.join(HERE, '..', 'firestore.rules'), 'utf8');
    const lr = await fetch(`${up.cfg.firestore.origin}/emulator/v1/projects/${up.cfg.projectId}:securityRules`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }) });
    const { ctx, page } = await open(s);
    await signInAs(page, NOACC);
    const tok = await ownToken(page); const uid = uidOf(s, NOACC);
    const fsBase = `${up.cfg.firestore.origin}/v1/projects/${up.cfg.projectId}/databases/(default)/documents`;
    const asUser = (url, init = {}) => fetch(url, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` } }).then((r) => r.status);
    const field = (v) => ({ stringValue: v });
    const tries = {
      selfBind: await asUser(`${fsBase}/authBindings/${uid}`, { method: 'PATCH', body: JSON.stringify({ fields: { authUid: field(uid), principalId: field('ACTOR-SC01-TEACHER'), status: field('active'), activatedAt: field('2026-01-01T00:00:00Z') } }) }),
      selfMember: await asUser(`${fsBase}/workspaces/WS-SC01/memberships/M-SELF`, { method: 'PATCH', body: JSON.stringify({ fields: { principalId: field('ACTOR-OTHER') } }) }),
      readMembers: await asUser(`${fsBase}/workspaces/WS-SC01/memberships`),
      readLeave: await asUser(`${fsBase}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'leaveRecords', allDescendants: true }] } }) }),
    };
    // through the API: there is no route for bindings / memberships, and role fields in a request are refused
    const viaApi = await page.evaluate(async (token) => {
      const post = async (p, body) => (await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })).status;
      return {
        bindRoute: await post('/v1/bind', { uid: 'x' }),
        roleField: await post('/v1/read', { op: 'attendanceSession.read', target: { sessionId: 'AS-SC01-20261116-DAILY' }, claimedScope: { workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01' }, principalId: 'ACTOR-SC01-TEACHER', role: 'admin' }),
      };
    }, tok);
    const binding = await up.h.getDoc(`authBindings/${uid}`);
    log(lr.status === 200 && Object.values(tries).every((x) => x === 403) && viaApi.bindRoute === 404 && viaApi.roleField === 403 && binding === null && await gateKind(page) === 'noAccess',
      'L14 a signed-in client cannot give itself access: direct Firestore writes/reads with its own token → 403 (this repository\'s firestore.rules), no API route for bindings (404), forged principalId / role fields → 403; no binding was created',
      `rules=${lr.status} ${JSON.stringify(tries)} api=${JSON.stringify(viaApi)}`);
    await ctx.close();
  }

  /* ---------- L15 the owner's trusted admin script grants access; the user then presses 重新檢查 */
  {
    const s = await world(); const { ctx, page } = await open(s);
    await signInAs(page, 'new');
    const before = await gateKind(page);
    const newUid = await page.evaluate(() => { for (let i = 0; i < sessionStorage.length; i += 1) { const k = sessionStorage.key(i); if (k.startsWith('firebase:authUser:')) return JSON.parse(sessionStorage.getItem(k)).uid; } return null; });
    const admin = createAdmin(createEmulatorBackend({ projectId: up.cfg.projectId, origin: up.cfg.firestore.origin }), { actor: 'e2e-test-owner' });
    let refusedUnknown = false; try { await admin.bind(newUid, 'ACTOR-DOES-NOT-EXIST'); } catch { refusedUnknown = true; }
    await admin.bind(newUid, 'ACTOR-SC01-TEACHER');
    await page.click('#recheckButton'); await waitLeave(page);
    const t = await mainText(page);
    const adminAudit = audits(await state()).filter((a) => a.action === 'admin.bind' && a.authUid === newUid);
    await admin.unbind(newUid);
    await page.evaluate(() => document.getElementById('sessionSelect').dispatchEvent(new Event('change')));
    await page.waitForFunction(() => document.getElementById('gate').dataset.kind === 'noAccess' && !document.getElementById('gate').hidden, null, { timeout: 30000 });
    log(before === 'noAccess' && refusedUnknown && t.includes('LV-007') && adminAudit.length === 1 && (await domLeak(page)).length === 0,
      'L15 a new account has no access until the owner\'s admin script binds it (an unknown principal is refused); 重新檢查 then shows SC01; unbinding takes effect on the next read; each admin change is audited');
    await ctx.close();
  }

  /* ---------- layouts of the login screens (no horizontal overflow) */
  {
    const s = await world(); const over = [];
    for (const [n, w, h] of [['phone', 390, 844], ['tablet', 820, 1180], ['desktop', 1440, 900], ['classroom', 1024, 768]]) {
      const { ctx, page } = await open(s, { width: w, height: h });
      if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) over.push(`${n}-login`);
      await page.screenshot({ path: path.join(OUT, 'screens', `signed-out-${n}-${w}x${h}.png`), fullPage: true });
      await signInAs(page, SC01); await waitLeave(page);
      if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) over.push(`${n}-in`);
      await page.screenshot({ path: path.join(OUT, 'screens', `signed-in-${n}-${w}x${h}.png`), fullPage: true });
      await ctx.close();
    }
    log(over.length === 0, 'login screens: no horizontal overflow at 390×844, 820×1180, 1440×900, 1024×768 (signed out and signed in)', over.join(',') || 'none');
  }
} catch (e) {
  log(false, 'E2E-login aborted', e.stack.split('\n').slice(0, 4).join(' | '));
} finally {
  if (current) await current.stop();
  await browser.close();
  await new Promise((r) => faultServer.close(r));
  await up.close();
}
writeFileSync(path.join(OUT, 'e2e-login-results.json'), JSON.stringify({ upstreamCommit: process.env.CMN_UPSTREAM_COMMIT || null, kind: 'SIMULATED Google sign-in (Auth Emulator)', results }, null, 2));
const ok = results.length > 0 && results.every((r) => r.ok);
console.log(`W1_E2E ok=${ok} checks=${results.filter((r) => r.ok).length}/${results.length} out=${OUT}`);
process.exit(ok ? 0 : 1);
