/** W1 end-to-end acceptance (SPEC §6 items 1–11, DESIGN §7) on the REAL Auth/Firestore emulators and the PINNED
 *  upstream controlled API. Runs only inside `firebase emulators:exec` (test/run-e2e.mjs). Every check is judged
 *  from the page (Playwright) AND from upstream state / the upstream front trace — never from the page's own claim.
 *  A test-only FAULT proxy (port 18401) sits between the web proxy and the upstream front proxy for items 5/7/8/10;
 *  it is not part of the product proxy. Fictional data only. */
import http from 'node:http';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { openUpstream, startScenario } from '../dev/world.mjs';
import { WEB_PORT } from '../dev/upstream.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Playwright: the project devDependency (npm ci), or a pre-installed global one (resolved through NODE_PATH)
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.env.W1_OUT || path.join(HERE, '..', 'test-results', `w1-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}`);
mkdirSync(path.join(OUT, 'screens'), { recursive: true });
const FAULT_PORT = 18401;
const LV_REV = /\/leaveRecords\/LV-007\/revisions\/[^/]+$/;
const ENTRY = /\/attendanceSessions\/AS-SC01-20261116-DAILY\/entries\/AT-20261116-07$/;

const up = await openUpstream(process.env.CMN_UPSTREAM_STAGE2);
const results = []; const log = (ok, name, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

/* ---------------- test-only fault proxy: web proxy → [fault] → upstream front proxy */
const fault = { dropCommit: 0, receipt: null, read: null, afterCommit: null, committed: false, seen: [] };
const faultServer = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    fault.seen.push(req.url);
    // WEB5-REV-001: after a commit went through, the re-read of the leave record is delayed / fails / is refused
    if (req.url === '/v1/read' && fault.afterCommit && fault.committed) {
      if (fault.afterCommit === 'delay') await new Promise((r) => setTimeout(r, 2500));
      else {
        const [status, code] = fault.afterCommit === '403' ? [403, 'FORBIDDEN'] : [503, 'UNAVAILABLE'];
        res.writeHead(status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ code, traceId: 'TR-injected-by-test' }));
      }
    }
    if (req.url === '/v1/read' && fault.read) {
      const [status, code] = fault.read === '403' ? [403, 'FORBIDDEN'] : [503, 'UNAVAILABLE'];
      res.writeHead(status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ code, traceId: 'TR-injected-by-test' }));
    }
    if (req.url === '/v1/receipt' && fault.receipt) {
      if (fault.receipt === 'drop') return req.socket.destroy();
      const [status, code] = fault.receipt === '403' ? [403, 'FORBIDDEN'] : [503, 'UNAVAILABLE'];
      res.writeHead(status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ code, traceId: 'TR-injected-by-test' }));
    }
    try {
      const r = await fetch(`http://127.0.0.1:${up.PORTS.front}${req.url}`, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json', authorization: req.headers.authorization || '' }, body: Buffer.concat(chunks) });
      const text = await r.text();
      if (req.url === '/v1/commit' && r.status === 200) fault.committed = true;
      if (req.url === '/v1/commit' && fault.dropCommit > 0) { fault.dropCommit -= 1; return req.socket.destroy(); }   // committed upstream, response lost
      res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(text);
    } catch { req.socket.destroy(); }
  });
});
await new Promise((r) => faultServer.listen(FAULT_PORT, '127.0.0.1', r));

const browser = await chromium.launch();
let current = null;
async function scenario(name, { viaFault = false } = {}) {
  if (current) await current.stop();
  fault.dropCommit = 0; fault.receipt = null; fault.read = null; fault.afterCommit = null; fault.committed = false; fault.seen = [];
  current = await startScenario(up, { scenario: name, webPort: WEB_PORT, upstreamOverride: viaFault ? `http://127.0.0.1:${FAULT_PORT}` : null });
  return current;
}
const frontCommits = (s) => readFileSync(path.join(s.traceDir, 'trace-front.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.path === '/v1/commit');
const opIdsOf = (s) => new Set(frontCommits(s).map((e) => e.requestBody?.command?.operationId).filter(Boolean));
const state = async () => (await up.h.exportState()).docs;
const revisions = (docs) => Object.keys(docs).filter((k) => LV_REV.test(k));
const entryOf = (docs) => Object.entries(docs).find(([k]) => ENTRY.test(k))?.[1] ?? null;
async function openPage(s, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(s.url);
  await page.locator('#p1Body table, #p1Body .denied, #p1Body button').first().waitFor();
  return { ctx, page };
}
const waitLeaveLoaded = (page) => page.locator('#p2Body dl, #p2Body .denied').first().waitFor();
const statusOf = (page) => page.locator('#statusRegion').getAttribute('data-state');
const waitState = (page, ...states) => page.waitForFunction((st) => st.includes(document.getElementById('statusRegion').dataset.state), states, { timeout: 30000 });
async function confirmRevision(page) { await page.click('#reviseButton'); await page.locator('#confirmDialog[open]').waitFor(); await page.click('#confirmButton'); }
const leaveText = (page) => page.locator('#p2Body').innerText();
/** status label as RENDERED in the DOM for the state the page is in (recorded for the label check at the end) */
const labelsSeen = {};
async function recordLabel(page) {
  const st = await statusOf(page);
  const tag = await page.locator('#statusRegion .tag').first().innerText().catch(() => null);
  const visible = await page.locator('#p4').isVisible();
  (labelsSeen[st] ||= []).push({ tag, visible });
}
/** forcibly enable 更正為全天 and click it: the page logic itself must refuse to open the dialog */
async function forcedRevise(page) {
  await page.evaluate(() => { const b = document.getElementById('reviseButton'); b.disabled = false; b.click(); });
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() => document.getElementById('confirmDialog').open);
  if (opened) await page.evaluate(() => document.getElementById('confirmButton').click());   // would freeze + send
  await page.waitForTimeout(300);
  return opened;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

try {
  /* ---------- item 1: roster counts equal the API; only this workspace */
  for (const [name, n] of [['S-ROSTER-A17', 15], ['S-LEAVE-SC01', 1]]) {
    const s = await scenario(name); const { ctx, page } = await openPage(s);
    const ui = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.summary div')].map((d) => [d.querySelector('dt').textContent, Number(d.querySelector('dd').textContent)])));
    const rows = await page.locator('table.roster tbody tr').count();
    const c = { P: ui.P, R: ui.R, N: ui.N, U: ui.U, total: ui['合計'], arrived: ui['已到（P+R）'], registered: ui['已登記（P+R+N）'] };
    const docs = await state();
    const ws = name === 'S-ROSTER-A17' ? 'WS-A17' : 'WS-SC01';
    const stateEntries = Object.keys(docs).filter((k) => k.startsWith(`workspaces/${ws}/`) && /\/entries\/[^/]+$/.test(k));
    // expected values from the AUTHORITATIVE upstream state (session rosterSnapshot + entries), not from the page
    const sid = name === 'S-ROSTER-A17' ? 'AS-A17-20261117-DAILY' : 'AS-SC01-20261116-DAILY';
    const sesKey = Object.keys(docs).find((k) => k.startsWith(`workspaces/${ws}/`) && k.endsWith(`/attendanceSessions/${sid}`));
    const sesDoc = sesKey ? docs[sesKey] : null;
    const seatOf = new Map((sesDoc?.rosterSnapshot || []).map((r) => [r.enrollmentId, r.seatNo]));
    const ents = Object.entries(docs).filter(([k]) => sesKey && k.startsWith(`${sesKey}/entries/`) && !k.slice(sesKey.length + 9).includes('/')).map(([, v]) => v);
    const exp = { P: 0, R: 0, N: 0, U: 0 }; for (const e of ents) exp[e.status] += 1;
    const expected = { ...exp, total: ents.length, arrived: exp.P + exp.R, registered: exp.P + exp.R + exp.N };
    const expRows = ents.map((e) => [String(seatOf.get(e.enrollmentId) ?? '—'), e.status]).sort((a, b) => Number(a[0]) - Number(b[0]));
    const uiRows = await page.locator('table.roster tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)));
    const ok = JSON.stringify(c) === JSON.stringify(expected) && rows === n && ents.length === n && stateEntries.length === n && JSON.stringify(uiRows) === JSON.stringify(expRows);
    log(ok, `item 1 ${name}: P/R/N/U, 合計, 已到, 已登記 and every row (座號, 狀態) equal the authoritative ${ws} state; rows=${n}, only ${ws}`, `ui=${JSON.stringify(c)} expected=${JSON.stringify(expected)} rowsEqual=${JSON.stringify(uiRows) === JSON.stringify(expRows)}`);
    await ctx.close();
  }

  /* ---------- item 2: success → v6, 全天; attendance unchanged (initial reset state) */
  {
    const s = await scenario('S-LEAVE-SC01'); const before = await state(); const { ctx, page } = await openPage(s); await waitLeaveLoaded(page);
    const t0 = await leaveText(page);
    await confirmRevision(page); await waitState(page, 'done');
    await page.waitForFunction(() => document.getElementById('p2Body').innerText.includes('v6'));
    const after = await state(); const t1 = await leaveText(page);
    log(t0.includes('上午') && t0.includes('v5') && t1.includes('全天') && t1.includes('v6') && revisions(after).length === 1 && JSON.stringify(entryOf(before)) === JSON.stringify(entryOf(after)) && entryOf(after)?.status === 'N',
      'item 2: AM→全天 succeeds at v6 from the reset initial state; attendance N unchanged', `before="${t0.replace(/\s+/g, ' ')}" after="${t1.replace(/\s+/g, ' ')}" revisions=${revisions(after).length}`);
    await ctx.close();
  }

  /* ---------- item 2b (WEB5-REV-001): the 完成 text follows the re-read that comes after the receipt — while it is
     slow, after it fails (503) and after it is refused (403); the receipt stays, nothing is re-sent */
  for (const mode of ['delay', '503', '403']) {
    const s = await scenario('S-LEAVE-SC01', { viaFault: true }); const { ctx, page } = await openPage(s); await waitLeaveLoaded(page);
    fault.afterCommit = mode;
    await confirmRevision(page); await waitState(page, 'done');
    const resultText = () => page.locator('#statusRegion').innerText();
    let during = null; let after = null; let retried = null;
    if (mode === 'delay') {
      during = await resultText();
      await page.waitForFunction(() => document.getElementById('p2Body').innerText.includes('v6'));
      after = await resultText();
    } else {
      await page.waitForFunction((m) => document.getElementById('p2Body').innerText.includes(m === '403' ? '無法存取' : '目前無法讀取'), mode);
      after = await resultText();
      if (mode === '503') {
        fault.afterCommit = null;
        await page.getByRole('button', { name: '重試' }).click();
        await page.waitForFunction(() => document.getElementById('p2Body').innerText.includes('v6'));
        retried = await resultText();
      }
    }
    const opId = [...opIdsOf(s)][0]; const docs = await state();
    const tag = await page.locator('#statusRegion .tag').first().innerText();
    const okText = mode === 'delay'
      ? during.includes('正在重新讀取') && !during.includes('已重新讀取，是最新內容') && after.includes('已重新讀取，是最新內容')
      : after.includes('重新讀取請假紀錄沒有成功') && !after.includes('已重新讀取，是最新內容') && (mode !== '503' || retried.includes('已重新讀取，是最新內容'));
    log(okText && tag === '完成' && (await statusOf(page)) === 'done' && after.includes(opId) && frontCommits(s).length === 1 && opIdsOf(s).size === 1 && revisions(docs).length === 1,
      `item 2b: after the receipt, the leave re-read ${mode === 'delay' ? 'is slow → 「正在重新讀取」, then 「已重新讀取，是最新內容」' : mode === '503' ? 'fails (503) → 完成 stays, text says the re-read failed; 重試 → 「已重新讀取」' : 'is refused (403) → 完成 stays, text says the re-read failed'}; receipt kept, one commit, one operationId, one revision`,
      `during="${(during || '').replace(/\s+/g, ' ').slice(0, 60)}" after="${after.replace(/\s+/g, ' ').slice(0, 90)}" commits=${frontCommits(s).length} opIds=${opIdsOf(s).size}`);
    await ctx.close();
  }

  /* ---------- item 3 + 9: two tabs at once → one done, one conflict; after conflict nothing is sent without re-confirmation */
  {
    const s = await scenario('S-LEAVE-SC01'); const a = await openPage(s); const b = await openPage(s); await waitLeaveLoaded(a.page); await waitLeaveLoaded(b.page);
    for (const p of [a.page, b.page]) { await p.click('#reviseButton'); await p.locator('#confirmDialog[open]').waitFor(); }
    await Promise.all([a.page.click('#confirmButton'), b.page.click('#confirmButton')]);
    await waitState(a.page, 'done', 'conflict'); await waitState(b.page, 'done', 'conflict');
    await recordLabel(a.page); await recordLabel(b.page);
    const st = [await statusOf(a.page), await statusOf(b.page)].sort();
    const docs = await state();
    log(JSON.stringify(st) === JSON.stringify(['conflict', 'done']) && revisions(docs).length === 1, 'item 3: two tabs confirm at once → exactly one 完成 and one 衝突; one revision (no silent overwrite)', `states=${st} revisions=${revisions(docs).length}`);
    const loser = (await statusOf(a.page)) === 'conflict' ? a.page : b.page;
    const commitsBefore = frontCommits(s).length;
    await loser.getByRole('button', { name: '重新讀取' }).click();
    await loser.waitForFunction(() => document.getElementById('p2Body').innerText.includes('v6'));
    await loser.waitForTimeout(500);
    const hint9 = await loser.locator('#reviseHint').innerText();
    log(frontCommits(s).length === commitsBefore && await loser.locator('#reviseButton').isDisabled() && (await leaveText(loser)).includes('全天') && hint9.includes('已是全天'),
      'item 9: after a conflict the page re-reads (v6 全天) and sends NOTHING without a new confirmation', `commits ${commitsBefore}→${frontCommits(s).length}`);
    await a.ctx.close(); await b.ctx.close();
  }

  /* ---------- item 9b (WEB2-REV-002): after a conflict, NO new operation before a successful fresh read —
     not by forcing the button, not after a failed (503) or refused (403) re-read */
  {
    const s = await scenario('S-LEAVE-SC01', { viaFault: true }); const a = await openPage(s); const b = await openPage(s); await waitLeaveLoaded(a.page); await waitLeaveLoaded(b.page);
    await confirmRevision(a.page); await waitState(a.page, 'done');                 // a wins at v5 → v6
    await confirmRevision(b.page); await waitState(b.page, 'conflict');             // b still holds v5 → conflict
    const c0 = frontCommits(s).length; const o0 = opIdsOf(s).size;
    const staleShown = (await leaveText(b.page)).includes('以上內容已不是最新');
    const disabled0 = await b.page.locator('#reviseButton').isDisabled();
    const forced0 = await forcedRevise(b.page);
    fault.read = '503';
    await b.page.getByRole('button', { name: '重新讀取' }).click();
    await b.page.waitForFunction(() => document.getElementById('p2Body').innerText.includes('目前無法讀取'));
    const disabled1 = await b.page.locator('#reviseButton').isDisabled(); const forced1 = await forcedRevise(b.page);
    fault.read = '403';
    await b.page.getByRole('button', { name: '重試' }).click();
    await b.page.waitForFunction(() => document.getElementById('p2Body').innerText.includes('無法存取'));
    const disabled2 = await b.page.locator('#reviseButton').isDisabled(); const forced2 = await forcedRevise(b.page);
    fault.read = null;
    await b.page.reload(); await waitLeaveLoaded(b.page);
    const fresh = await leaveText(b.page);
    const docs = await state();
    const ok = staleShown && disabled0 && !forced0 && disabled1 && !forced1 && disabled2 && !forced2 && frontCommits(s).length === c0 && opIdsOf(s).size === o0 && c0 === 2 && revisions(docs).length === 1 && fresh.includes('全天') && fresh.includes('v6');
    log(ok, 'item 9b: after a conflict and BEFORE a successful re-read (also after a 503 or 403 re-read) 更正為全天 stays disabled; forcing it opens no dialog; no new operationId, no new commit',
      `stale=${staleShown} disabled=${disabled0}/${disabled1}/${disabled2} forcedOpened=${forced0}/${forced1}/${forced2} commits ${c0}→${frontCommits(s).length} opIds ${o0}→${opIdsOf(s).size}`);
    await a.ctx.close(); await b.ctx.close();
  }

  /* ---------- item 4: double activation → one modification, one operationId */
  {
    const s = await scenario('S-LEAVE-SC01'); const { ctx, page } = await openPage(s); await waitLeaveLoaded(page);
    await page.click('#reviseButton'); await page.locator('#confirmDialog[open]').waitFor();
    await page.locator('#confirmButton').dblclick({ force: true }).catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
    await waitState(page, 'done'); await recordLabel(page);
    await page.waitForTimeout(500);
    const docs = await state();
    log(revisions(docs).length === 1 && frontCommits(s).length === 1 && opIdsOf(s).size === 1, 'item 4: double click + Enter on confirm → one commit request, one operationId, one revision', `commits=${frontCommits(s).length} opIds=${opIdsOf(s).size} revisions=${revisions(docs).length}`);
    await ctx.close();
  }

  /* ---------- item 5: committed but the response is lost → 尚未確認 → 查詢結果 → the same receipt */
  {
    const s = await scenario('S-LEAVE-SC01', { viaFault: true }); const { ctx, page } = await openPage(s); await waitLeaveLoaded(page);
    fault.dropCommit = 1;
    await confirmRevision(page); await waitState(page, 'unknown');
    const unknownText = await page.locator('#statusRegion').innerText(); await recordLabel(page);
    const unknownHint = await page.locator('#reviseHint').innerText(); const unknownFocus = await page.evaluate(() => document.activeElement?.id);
    await page.screenshot({ path: path.join(OUT, 'screens', 'state-unknown-1440.png'), fullPage: true });
    const opId = [...opIdsOf(s)][0];
    await page.getByRole('button', { name: '查詢結果' }).click(); await waitState(page, 'done');
    const doneText = await page.locator('#statusRegion').innerText();
    const docs = await state();
    log(unknownText.includes('尚未確認') && !unknownText.includes('已更正') && unknownHint.includes('尚未確認') && unknownFocus === 'p4Title' && doneText.includes(opId) && revisions(docs).length === 1 && opIdsOf(s).size === 1 && frontCommits(s).length === 1,
      'item 5: response lost → 「尚未確認」 (not 完成/未修改), focus moved to the result, the button hint explains the lock → 查詢結果 recovers the same receipt; one revision, one operationId', `focus=${unknownFocus} hint="${unknownHint}" opId=${opId} revisions=${revisions(docs).length} commits=${frontCommits(s).length}`);
    await ctx.close();
  }

  /* ---------- item 6: S-DENY — every route / target the site uses, plus nonexistent targets → identical denial */
  {
    const s = await scenario('S-DENY'); const { ctx, page } = await openPage(s); await waitLeaveLoaded(page);
    const p1 = await page.locator('#p1Body').innerText(); const p2 = await page.locator('#p2Body').innerText();
    const probes = await page.evaluate(async () => {
      const post = async (p, b) => { const r = await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json().catch(() => null); return { status: r.status, keys: j ? Object.keys(j).sort().join(',') : null, code: j?.code }; };
      const S = { workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01' };
      const cmd = (targetId) => ({ command: { schemaVersion: '1.0', workspaceId: 'WS-SC01', operationId: crypto.randomUUID(), commandType: 'LeaveRecord.Revise', targetType: 'LeaveRecord', targetId, expectedVersion: 5, intent: { coverageChange: 'AM_TO_FULL_DAY', reasonCode: 'SOURCE_CORRECTION' }, clientCreatedAt: new Date().toISOString() }, claimedScope: S });
      return {
        session: [await post('/v1/read', { op: 'attendanceSession.read', target: { sessionId: 'AS-SC01-20261116-DAILY' }, claimedScope: S }), await post('/v1/read', { op: 'attendanceSession.read', target: { sessionId: 'AS-NOPE-0000' }, claimedScope: S })],
        summary: [await post('/v1/read', { op: 'attendanceSummary.read', target: { sessionId: 'AS-SC01-20261116-DAILY' }, claimedScope: S }), await post('/v1/read', { op: 'attendanceSummary.read', target: { sessionId: 'AS-NOPE-0000' }, claimedScope: S })],
        leave: [await post('/v1/read', { op: 'leaveRecord.read', target: { leaveRecordId: 'LV-007' }, claimedScope: S }), await post('/v1/read', { op: 'leaveRecord.read', target: { leaveRecordId: 'LV-NOPE' }, claimedScope: S })],
        commit: [await post('/v1/commit', cmd('LV-007')), await post('/v1/commit', cmd('LV-NOPE'))],
        receipt: [await post('/v1/receipt', { operationId: 'OP-SC01-EXAMPLE-0001', workspaceId: 'WS-SC01' }), await post('/v1/receipt', { operationId: 'OP-NOPE-0000', workspaceId: 'WS-SC01' })],
      };
    });
    const allSame = Object.values(probes).every(([x, y]) => x.status === 403 && y.status === 403 && x.keys === 'code,traceId' && y.keys === x.keys && x.code === 'FORBIDDEN' && y.code === 'FORBIDDEN');
    const denyUi = { dateHidden: await page.locator('#dateField').isHidden(), reviseBoxHidden: await page.locator('#reviseBox').isHidden() };
    log(p1.includes('無法存取') && p2.includes('無法存取') && await page.locator('#reviseButton').isDisabled() && denyUi.dateHidden && denyUi.reviseBoxHidden && allSame && revisions(await state()).length === 0,
      'item 6: S-DENY — P1/P2 show the generic 無法存取 (no date picker, no correction offered); every route used (session, summary, leave, commit, receipt) answers existing and nonexistent targets identically (403 {code, traceId})', JSON.stringify(Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, v.map((x) => x.status)]))));
    await ctx.close();
  }

  /* ---------- items 7 / 8: response lost, the receipt query fails (503 / dropped / 403) → still 尚未確認; resend the SAME operation */
  for (const mode of ['503', 'drop', '403']) {
    const s = await scenario('S-LEAVE-SC01', { viaFault: true }); const { ctx, page } = await openPage(s); await waitLeaveLoaded(page);
    fault.dropCommit = 1; fault.receipt = mode;
    await confirmRevision(page); await waitState(page, 'unknown');
    await page.getByRole('button', { name: '查詢結果' }).click(); await waitState(page, 'unknown');
    const afterQuery = await page.locator('#statusRegion').innerText();
    const commitsAfterQuery = frontCommits(s).length;
    fault.receipt = null;
    await page.getByRole('button', { name: '重新送出同一操作' }).click(); await waitState(page, 'done');
    const docs = await state();
    log(afterQuery.includes('尚未確認') && !afterQuery.includes('未提交') && commitsAfterQuery === 1 && frontCommits(s).length === 2 && opIdsOf(s).size === 1 && revisions(docs).length === 1,
      `item ${mode === '403' ? 8 : 7}: receipt query ${mode === '403' ? 'refused (403 FORBIDDEN)' : mode === 'drop' ? 'connection dropped' : '503'} → still 尚未確認, no new operationId; resending the SAME operation returns the original receipt; one revision`,
      `commits=${frontCommits(s).length} opIds=${opIdsOf(s).size} revisions=${revisions(docs).length}`);
    await ctx.close();
  }

  /* ---------- item 10: response lost, then the identity becomes invalid → resend refused → keep 尚未確認 */
  {
    const s = await scenario('S-LEAVE-SC01', { viaFault: true }); const { ctx, page } = await openPage(s); await waitLeaveLoaded(page);
    fault.dropCommit = 1;
    await confirmRevision(page); await waitState(page, 'unknown');
    await up.h.patchDoc(`authBindings/${s.users['ACTOR-SC01-TEACHER'].uid}`, { status: 'disabled' });
    await page.getByRole('button', { name: '重新送出同一操作' }).click(); await waitState(page, 'unknownDenied'); await recordLabel(page);
    const text = await page.locator('#statusRegion').innerText();
    const docs = await state();
    await page.screenshot({ path: path.join(OUT, 'screens', 'state-unknown-denied-1440.png'), fullPage: true });
    log(text.includes('先前的送出結果尚未確認，目前無法存取') && revisions(docs).length === 1 && opIdsOf(s).size === 1 && frontCommits(s).length === 2 && text.includes([...opIdsOf(s)][0]),
      'item 10: lost response, binding disabled, resend refused → 「先前的送出結果尚未確認，目前無法存取」, original operation kept; one revision; no new operationId', `commits=${frontCommits(s).length} opIds=${opIdsOf(s).size} revisions=${revisions(docs).length}`);
    await ctx.close();
  }

  /* ---------- item 11 (browser): top-level navigation works; a cross-origin page cannot get a POST through */
  {
    const s = await scenario('S-LEAVE-SC01');
    const evil = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><title>other</title>'); });
    await new Promise((r) => evil.listen(18402, '127.0.0.1', r));
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    const nav = await page.goto(s.url);
    // the page's own startup reads must be finished BEFORE the counters are taken (otherwise they land in the window)
    await waitLeaveLoaded(page); await page.waitForLoadState('networkidle');
    const before = s.proxy.stats.forwarded; const rejectedBefore = s.proxy.stats.rejected; const frontBefore = readFileSync(path.join(s.traceDir, 'trace-front.jsonl'), 'utf8').split('\n').filter(Boolean).length;
    await page.goto('http://127.0.0.1:18402/');
    const res = await page.evaluate(async (u) => { try { await fetch(`${u}v1/commit`, { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: '{}' }); } catch { /* */ } try { await fetch(`${u}v1/read`, { method: 'POST', mode: 'no-cors', body: '{}' }); } catch { /* */ } return true; }, s.url);
    await page.waitForTimeout(300);
    const frontAfter = readFileSync(path.join(s.traceDir, 'trace-front.jsonl'), 'utf8').split('\n').filter(Boolean).length;
    const rejected = s.proxy.stats.rejected - rejectedBefore;
    log(nav.status() === 200 && res && s.proxy.stats.forwarded === before && frontAfter === frontBefore && rejected >= 2, 'item 11: direct navigation 200; POSTs from another origin (127.0.0.1:18402) are refused by the proxy and never reach the upstream', `nav=${nav.status()} forwarded ${before}→${s.proxy.stats.forwarded} rejected+${rejected} front ${frontBefore}→${frontAfter}`);
    await ctx.close(); await new Promise((r) => evil.close(r));
  }

  /* ---------- DESIGN §7: four sizes, no horizontal overflow; keyboard; reduced motion; status labels */
  {
    const s = await scenario('S-LEAVE-SC01');
    const sizes = [['phone', 390, 844], ['tablet', 820, 1180], ['desktop', 1440, 900], ['ipad-landscape', 1024, 768]];
    const over = [];
    for (const [n, w, hgt] of sizes) {
      const { ctx, page } = await openPage(s, { width: w, height: hgt }); await waitLeaveLoaded(page);
      if (await overflow(page)) over.push(n);
      const narrow2 = await page.evaluate(() => [...document.querySelectorAll('caption, .muted, h2')].filter((e) => e.offsetParent && e.getBoundingClientRect().width < 120).map((e) => e.tagName + ':' + e.textContent.slice(0, 12)));
      if (narrow2.length) over.push(`${n}-narrow:${narrow2.join('|')}`);
      await page.screenshot({ path: path.join(OUT, 'screens', `initial-${n}-${w}x${hgt}.png`), fullPage: true });
      await ctx.close();
    }
    const r = await scenario('S-ROSTER-A17');
    for (const [n, w, hgt] of sizes) {
      const { ctx, page } = await openPage(r, { width: w, height: hgt });
      if (await overflow(page)) over.push(`roster-${n}`);
      // text blocks must use the available width (catches a caption collapsing into a one-character column)
      const narrow = await page.evaluate(() => [...document.querySelectorAll('caption, .muted, h2')].filter((e) => e.offsetParent && e.getBoundingClientRect().width < 120).map((e) => e.tagName + ':' + e.textContent.slice(0, 12)));
      if (narrow.length) over.push(`roster-${n}-narrow:${narrow.join('|')}`);
      await page.screenshot({ path: path.join(OUT, 'screens', `roster-a17-${n}-${w}x${hgt}.png`), fullPage: true });
      await ctx.close();
    }
    log(over.length === 0, 'DESIGN §7: no horizontal overflow and no collapsed text blocks at 390×844, 820×1180, 1440×900, 1024×768 (S-LEAVE-SC01 and S-ROSTER-A17)', over.join(',') || 'none');
  }
  {
    const s = await scenario('S-LEAVE-SC01'); const { ctx, page } = await openPage(s); await waitLeaveLoaded(page);
    // keyboard only: reach 更正為全天, open, Tab cycles inside the dialog, Escape closes and focus returns, then confirm with keyboard
    let reached = false;
    for (let i = 0; i < 12 && !reached; i += 1) { await page.keyboard.press('Tab'); reached = await page.evaluate(() => document.activeElement?.id === 'reviseButton'); }
    await page.keyboard.press('Enter'); await page.locator('#confirmDialog[open]').waitFor();
    const f0 = await page.evaluate(() => document.activeElement?.id);
    await page.keyboard.press('Tab'); const f1 = await page.evaluate(() => document.activeElement?.id);
    await page.keyboard.press('Tab'); const f2 = await page.evaluate(() => document.activeElement?.id);
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('confirmDialog').open);
    const back = await page.evaluate(() => document.activeElement?.id);
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    await page.keyboard.press('Enter'); await page.locator('#confirmDialog[open]').waitFor(); await page.keyboard.press('Enter');
    await waitState(page, 'done');
    const afterDone = await page.evaluate(() => document.activeElement?.id);
    log(reached && afterDone === 'p4Title' && f0 === 'confirmButton' && f1 === 'cancelButton' && f2 === 'confirmButton' && back === 'reviseButton' && ring !== 'none' && revisions(await state()).length === 1,
      'keyboard: Tab reaches 更正為全天; dialog focus starts on 確認, Tab cycles 確認→返回→確認; Escape closes and focus returns; visible focus ring; Enter completes the revision and focus moves to the result', `focus=${f0}/${f1}/${f2} back=${back} outline=${ring} afterDone=${afterDone}`);
    await ctx.close();
    const ctx2 = await browser.newContext({ reducedMotion: 'reduce' }); const p2 = await ctx2.newPage(); await p2.goto(s.url);
    const motion = await p2.evaluate(() => [...document.querySelectorAll('*')].every((n) => { const c = getComputedStyle(n); return c.animationName === 'none' && (c.transitionDuration === '0s' || c.transitionDuration.split(',').every((d) => parseFloat(d) === 0)); }));
    log(motion, 'prefers-reduced-motion: no animation or transition on any element');
    await ctx2.close();
  }
  {
    // judged from the RENDERED DOM recorded above, for the states this run actually reached (not from the source text)
    const labels = { done: '完成', conflict: '衝突', unknown: '尚未確認', unknownDenied: '尚未確認' };
    const ok = Object.entries(labels).every(([st, l]) => (labelsSeen[st] || []).length > 0 && labelsSeen[st].every((x) => x.visible && x.tag === l));
    log(ok, 'rendered text label for each reached state: done=完成, conflict=衝突, unknown=尚未確認, unknownDenied=尚未確認 (denied/invalid/error not reached in this run)', JSON.stringify(labelsSeen));
  }
} catch (e) {
  log(false, 'E2E aborted', e.stack.split('\n').slice(0, 4).join(' | '));
} finally {
  if (current) await current.stop();
  await browser.close();
  await new Promise((r) => faultServer.close(r));
  await up.close();
}
writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify({ kind: 'W1_E2E', upstream: process.env.CMN_UPSTREAM_COMMIT || null, results, ok: results.every((r) => r.ok) }, null, 1));
console.log(`W1_E2E ok=${results.every((r) => r.ok)} checks=${results.filter((r) => r.ok).length}/${results.length} out=${OUT}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
