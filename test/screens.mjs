/** W1 acceptance screenshots (DESIGN §3, §7): the REAL page on the REAL Auth/Firestore emulators and the PINNED
 *  upstream API, at 390×844, 820×1180, 1440×900, 1024×768. Runs only inside `firebase emulators:exec`
 *    node test/run-e2e.mjs --upstream <path> --script screens
 *  States that need a fault (result unconfirmed) use the SAME test-only fault proxy as test/e2e.mjs; the product page
 *  has no test buttons. Each flow starts from a fresh fictional world. Writes <out>/screens/*.png and manifest.json. */
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { openUpstream, startScenario } from '../dev/world.mjs';
import { WEB_PORT } from '../dev/upstream.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.env.W1_OUT || path.join(HERE, '..', 'test-results', `screens-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}`);
mkdirSync(path.join(OUT, 'screens'), { recursive: true });
const FAULT_PORT = 18401;
const SIZES = [['phone', 390, 844], ['tablet', 820, 1180], ['desktop', 1440, 900], ['classroom', 1024, 768]];

const up = await openUpstream(process.env.CMN_UPSTREAM_STAGE2);
const fault = { dropCommit: 0 };
const faultServer = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${up.PORTS.front}${req.url}`, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json', authorization: req.headers.authorization || '' }, body: Buffer.concat(chunks) });
      const text = await r.text();
      if (req.url === '/v1/commit' && fault.dropCommit > 0) { fault.dropCommit -= 1; return req.socket.destroy(); }   // committed upstream, response lost
      res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(text);
    } catch { req.socket.destroy(); }
  });
});
await new Promise((r) => faultServer.listen(FAULT_PORT, '127.0.0.1', r));
const browser = await chromium.launch();
let current = null;
async function scenario(name, viaFault = false) {
  if (current) await current.stop();
  fault.dropCommit = 0;
  current = await startScenario(up, { scenario: name, webPort: WEB_PORT, upstreamOverride: viaFault ? `http://127.0.0.1:${FAULT_PORT}` : null });
  return current;
}
const manifest = []; const problems = [];
async function open(s, [, w, h]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); await page.goto(s.url);
  await page.locator('#p1Body table, #p1Body .denied, #p1Body button').first().waitFor();
  await page.waitForLoadState('networkidle');
  return { ctx, page };
}
const waitState = (page, ...st) => page.waitForFunction((x) => x.includes(document.getElementById('statusRegion').dataset.state), st, { timeout: 30000 });
async function shot(page, size, id, what, { full = true } = {}) {
  const file = `${id}-${size[0]}-${size[1]}x${size[2]}.png`;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  const banner = await page.locator('#scenarioBanner').innerText();
  await page.screenshot({ path: path.join(OUT, 'screens', file), fullPage: full });
  manifest.push({ file, id, size: `${size[1]}x${size[2]}`, what, banner, horizontalOverflow: overflow });
  if (overflow) problems.push(`${file}: horizontal overflow`);
  if (!banner.includes('虛構資料') || !banner.includes('暫定色票')) problems.push(`${file}: banner missing 虛構資料/暫定色票`);
}

try {
  for (const size of SIZES) {
    // 1. S-ROSTER-A17: roster, seat numbers, status codes, summary
    { const s = await scenario('S-ROSTER-A17'); const { ctx, page } = await open(s, size);
      await shot(page, size, '01-roster-a17', 'S-ROSTER-A17：P1 名冊（座號、狀態代碼）與摘要'); await ctx.close(); }
    // 2-4. S-LEAVE-SC01: AM → full day: initial, confirm dialog, done
    { const s = await scenario('S-LEAVE-SC01'); const { ctx, page } = await open(s, size);
      await page.locator('#p2Body dl').waitFor();
      await shot(page, size, '02-leave-initial', 'S-LEAVE-SC01：初始（LV-007 上午 v5）');
      await page.click('#reviseButton'); await page.locator('#confirmDialog[open]').waitFor();
      await shot(page, size, '03-leave-confirm', 'S-LEAVE-SC01：確認對話框', { full: false });
      await page.click('#confirmButton'); await waitState(page, 'done'); await page.waitForFunction(() => document.getElementById('p2Body').innerText.includes('v6'));
      await shot(page, size, '04-leave-done', 'S-LEAVE-SC01：成功（完成，全天 v6，收據）'); await ctx.close(); }
    // 5-6. two tabs → one conflict; after re-read
    { const s = await scenario('S-LEAVE-SC01'); const a = await open(s, size); const b = await open(s, size);
      await a.page.locator('#p2Body dl').waitFor(); await b.page.locator('#p2Body dl').waitFor();
      await a.page.click('#reviseButton'); await a.page.click('#confirmButton'); await waitState(a.page, 'done');
      await b.page.click('#reviseButton'); await b.page.click('#confirmButton'); await waitState(b.page, 'conflict');
      await shot(b.page, size, '05-conflict', '兩個分頁：後送出的分頁顯示「衝突」，舊內容標示為不是最新');
      await b.page.getByRole('button', { name: '重新讀取' }).click(); await b.page.waitForFunction(() => document.getElementById('p2Body').innerText.includes('v6'));
      await shot(b.page, size, '06-conflict-reread', '衝突後按「重新讀取」：顯示最新內容（全天 v6），更正按鈕停用');
      await a.ctx.close(); await b.ctx.close(); }
    // 7. S-DENY
    { const s = await scenario('S-DENY'); const { ctx, page } = await open(s, size);
      await page.locator('#p2Body .denied').waitFor();
      await shot(page, size, '07-deny', 'S-DENY：一般的「無法存取」'); await ctx.close(); }
    // 8-9. fault injection (test-only proxy): response lost → 尚未確認; then binding disabled → 尚未確認，目前無法存取
    { const s = await scenario('S-LEAVE-SC01', true); const { ctx, page } = await open(s, size);
      await page.locator('#p2Body dl').waitFor(); fault.dropCommit = 1;
      await page.click('#reviseButton'); await page.click('#confirmButton'); await waitState(page, 'unknown');
      await shot(page, size, '08-unknown', '［故障注入］提交已發生但回應遺失：「尚未確認」與「查詢結果」「重新送出同一操作」');
      await up.h.patchDoc(`authBindings/${s.users['ACTOR-SC01-TEACHER'].uid}`, { status: 'disabled' });
      await page.getByRole('button', { name: '重新送出同一操作' }).click(); await waitState(page, 'unknownDenied');
      await shot(page, size, '09-unknown-denied', '［故障注入］之後身分失效、重送被拒：「先前的送出結果尚未確認，目前無法存取」'); await ctx.close(); }
  }
} catch (e) {
  problems.push(`aborted: ${String(e.stack || e).split('\n').slice(0, 4).join(' | ')}`);
} finally {
  if (current) await current.stop();
  await browser.close();
  await new Promise((r) => faultServer.close(r));
  await up.close();
}
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ upstreamCommit: process.env.CMN_UPSTREAM_COMMIT || null, screens: manifest, problems }, null, 2));
for (const p of problems) console.log(`FAIL ${p}`);
console.log(`OK   screens: ${manifest.length} captured`);
console.log(`W1_E2E ok=${problems.length === 0} checks=${manifest.length}/${9 * SIZES.length} out=${OUT}`);
process.exit(problems.length === 0 ? 0 : 1);
