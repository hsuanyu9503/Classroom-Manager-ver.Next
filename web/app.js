/* W1 page logic. SPEC §2 (pages), §4 (submission outcomes), §5 (nothing persisted in the browser).
   The page holds no token: the local proxy adds it (SPEC §3). The only memory is the current frozen operation.
   The outcome rules (frozen operation, resend, 403 handling, receipt query, conflict lock) are unchanged by the
   UI refresh; only presentation, wording and focus handling changed. */
'use strict';
(() => {
  /* Targets of the FIXED fictional test data (upstream Stage 1 fixtures). Identifiers only — no student data.
     The date list is limited to sessions that exist in that data (DESIGN §6). */
  const TARGETS = {
    'S-ROSTER-A17': { scope: { workspaceId: 'WS-A17', classId: 'CLASS-606-A17' }, sessions: [{ date: '2026-11-17', sessionId: 'AS-A17-20261117-DAILY' }], leave: null },
    'S-LEAVE-SC01': { scope: { workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01' }, sessions: [{ date: '2026-11-16', sessionId: 'AS-SC01-20261116-DAILY' }], leave: { leaveRecordId: 'LV-007' } },
    // S-DENY: ACTOR-OTHER has no membership; the page shows the same generic denial for every target
    'S-DENY': { scope: { workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01' }, sessions: [{ date: '2026-11-16', sessionId: 'AS-SC01-20261116-DAILY' }], leave: { leaveRecordId: 'LV-007' } },
  };
  const DAYPART = { AM: '上午', PM: '下午', FULL_DAY: '全天' };
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, props); for (const k of kids) n.append(k); return n; };

  let cfg = null;
  let leave = null;          // last leave record read from the API
  let leaveState = 'none';   // none | loading | ok | denied | unavailable | stale  (for the hint only)
  /** The frozen operation (SPEC §4-1): operationId + the COMPLETE request body, created once, never rebuilt. */
  let op = null;             // { operationId, bodyText, expectedVersion }
  let state = 'idle';        // idle | sending | done | conflict | unknown | unknownDenied | denied | invalid | error
  let note = '';
  let lastReceipt = null;
  let renderedState = 'idle';

  async function api(path, bodyText) {
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: bodyText, cache: 'no-store', credentials: 'same-origin' });
      let body = null; try { body = await r.json(); } catch { /* non-JSON */ }
      return { status: r.status, body };
    } catch { return { status: 0, body: null }; }   // network error / connection lost
  }
  const read = (opName, target) => api('/v1/read', JSON.stringify({ op: opName, target, claimedScope: cfg.scope }));
  const isOk = (r) => r.status === 200 && r.body && r.body.code === 'OK';
  const denial = () => el('p', { className: 'denied' }, el('span', { className: 'tag tag-denied', textContent: '無法存取' }), '無法存取。');
  const unavailable = (retry) => el('div', { className: 'unavailable' }, el('p', { textContent: '目前無法讀取，請稍後再試。' }), el('button', { type: 'button', textContent: '重試', onclick: retry }));
  const stat = (k, v, cls = '') => el('div', { className: cls }, el('dt', { textContent: k }), el('dd', { textContent: String(v) }));

  /* ---------------- P1 roster and summary */
  async function loadRoster() {
    const sessionId = $('sessionSelect').value;
    const body = $('p1Body'); body.replaceChildren(el('p', { className: 'loading', textContent: '讀取中…' }));
    const [ses, sum] = await Promise.all([read('attendanceSession.read', { sessionId }), read('attendanceSummary.read', { sessionId })]);
    if (ses.status === 403 || sum.status === 403) { $('dateField').hidden = true; return body.replaceChildren(denial()); }
    if (!isOk(ses) || !isOk(sum)) return body.replaceChildren(unavailable(loadRoster));
    $('dateField').hidden = false;
    const c = sum.body.data.counts;
    // main figures first, then the per-code breakdown (codes only: their names are not decided — AQ-1)
    const main = el('dl', { className: 'summary summary-main' }); main.setAttribute('aria-label', '點名摘要');
    for (const [k, v] of [['合計', c.total], ['已到（P+R）', c.arrived], ['已登記（P+R+N）', c.registered]]) main.append(stat(k, v));
    const codes = el('dl', { className: 'summary summary-codes' }); codes.setAttribute('aria-label', '各狀態代碼的人數');
    for (const k of ['P', 'R', 'N', 'U']) codes.append(stat(k, c[k], `code-stat code-${k}`));
    const seat = new Map(ses.body.data.rosterSnapshot.map((r) => [r.enrollmentId, r.seatNo]));
    const rows = ses.body.data.entries.map((e) => ({ seat: seat.get(e.enrollmentId), status: e.status })).sort((a, b) => (a.seat ?? 1e9) - (b.seat ?? 1e9));
    const table = el('table', { className: 'roster' });
    table.append(el('caption', { textContent: `${$('sessionSelect').selectedOptions[0].textContent}｜共 ${rows.length} 人（依座號排列）` }));
    const thead = el('thead'); thead.append(el('tr', {}, el('th', { scope: 'col', textContent: '座號' }), el('th', { scope: 'col', textContent: '狀態（代碼）' })));
    const tbody = el('tbody');
    for (const r of rows) {
      const a = el('td', { className: 'seat', textContent: r.seat == null ? '—' : String(r.seat) }); a.dataset.label = '座號';
      const b = el('td', { className: 'status' }, el('span', { className: `code code-${r.status}`, textContent: r.status })); b.dataset.label = '狀態';
      tbody.append(el('tr', {}, a, b));
    }
    table.append(thead, tbody);
    body.replaceChildren(el('div', { className: 'summary-wrap' }, main, codes), table);
  }

  /* ---------------- P2 leave summary */
  async function loadLeave() {
    const body = $('p2Body'); body.replaceChildren(el('p', { className: 'loading', textContent: '讀取中…' }));
    leave = null; leaveState = 'loading'; updateReviseButton();
    const r = await read('leaveRecord.read', { leaveRecordId: cfg.leave.leaveRecordId });
    if (r.status === 403) { leaveState = 'denied'; updateReviseButton(); return body.replaceChildren(denial()); }
    if (!isOk(r)) { leaveState = 'unavailable'; updateReviseButton(); return body.replaceChildren(unavailable(loadLeave)); }
    leave = r.body.data; leaveState = 'ok';
    const segs = leave.coverageSegments || [];
    const part = segs.length === 1 ? (DAYPART[segs[0].dayPart] || segs[0].dayPart) : `${segs.length} 個時段`;
    const now = el('div', { className: 'leave-now' }, el('span', { className: 'leave-now-label', textContent: '涵蓋時段' }), el('span', { className: `daypart daypart-${segs.length === 1 ? segs[0].dayPart : 'MULTI'}`, textContent: part }));
    const dl = el('dl', { className: 'leave' });
    for (const [k, v] of [['請假紀錄', leave.leaveRecordId], ['假別', leave.leaveTypeId], ['版本', `v${leave.version}`]]) dl.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
    body.replaceChildren(now, dl);
    updateReviseButton();
  }
  const isAmOnly = () => !!leave && (leave.coverageSegments || []).length === 1 && leave.coverageSegments[0].dayPart === 'AM';
  const canRevise = () => isAmOnly() && op === null && state !== 'sending' && state !== 'conflict';
  /** After a conflict the shown record is outdated: drop it (so nothing can be frozen from it) and say so. Only a
   *  successful loadLeave() sets `leave` again; a failed or refused re-read leaves it null. */
  function markLeaveStale() {
    leave = null; leaveState = 'stale';
    $('p2Body').append(el('p', { className: 'stale', textContent: '以上內容已不是最新，請先重新讀取。' }));
  }
  /** the button plus a one-line reason why it can / cannot be used (same conditions as canRevise) */
  function updateReviseButton() {
    const ok = canRevise(); $('reviseButton').disabled = !ok;
    let hint = null;
    if (ok) hint = '可以把「上午」更正為「全天」。按下後會先請你確認。';
    else if (state === 'sending') hint = '送出中，請稍候。';
    else if (op !== null) hint = '上一次送出的結果尚未確認；確認之前不能再更正。';
    else if (state === 'conflict' || leaveState === 'stale') hint = '更正之前，需要先重新讀取最新內容。';
    else if (leave && !isAmOnly()) {
      const segs = leave.coverageSegments || [];
      hint = segs.length === 1 && segs[0].dayPart === 'FULL_DAY' ? '目前已是全天，沒有可以執行的更正。' : '這筆紀錄不是「上午」；W1 只提供「上午更正為全天」。';
    }
    $('reviseHint').textContent = hint || '';
    $('reviseBox').hidden = hint === null;   // loading, denied or unreadable: nothing to offer, say nothing
  }

  /* ---------------- P3 confirm → freeze → send */
  let opener = null;
  function openConfirm() {
    if (!canRevise()) return;
    opener = document.activeElement;
    $('confirmRecord').textContent = `${leave.leaveRecordId}（假別 ${leave.leaveTypeId}）`;
    $('confirmVersion').textContent = `v${leave.version}`;
    $('confirmText').textContent = '按「確認更正」後才會送出；點名狀態不會因此改變。';
    $('confirmButton').disabled = false;
    $('confirmDialog').showModal();
    $('confirmButton').focus();
  }
  function closeConfirm() { const d = $('confirmDialog'); if (d.open) d.close(); }
  function freezeOperation() {
    const operationId = crypto.randomUUID();
    const command = { schemaVersion: '1.0', workspaceId: cfg.scope.workspaceId, operationId, commandType: 'LeaveRecord.Revise', targetType: 'LeaveRecord', targetId: leave.leaveRecordId,
      expectedVersion: leave.version, intent: { coverageChange: 'AM_TO_FULL_DAY', reasonCode: 'SOURCE_CORRECTION' }, clientCreatedAt: new Date().toISOString() };
    return Object.freeze({ operationId, expectedVersion: leave.version, bodyText: JSON.stringify({ command, claimedScope: cfg.scope }) });
  }
  async function confirmAndSend() {
    if (state === 'sending' || op !== null) return;           // double activation reuses nothing new
    $('confirmButton').disabled = true;
    op = freezeOperation();
    closeConfirm();
    await send('first');
  }
  /** One submission of the FROZEN operation. phase: 'first' (just confirmed) | 'resend' (after an unknown result). */
  async function send(phase) {
    if (!op || state === 'sending') return;
    state = 'sending'; note = ''; render();
    const r = await api('/v1/commit', op.bodyText);
    const code = r.body && r.body.code;
    if (r.status === 200 && code === 'OK' && r.body.receipt && r.body.receipt.operationId === op.operationId) return finishDone(r.body.receipt);
    if (r.status === 409 && code === 'VERSION_CONFLICT') {
      // the receipt is checked first in the same transaction (upstream S2B1-AUTHORIZATION §8): this operation did NOT write
      // the leave record shown is now stale: it must NOT be usable for a new operation until a fresh read
      // succeeds (WEB2-REV-002; SPEC §4 「重新讀取、顯示最新內容後才重新確認」)
      op = null; state = 'conflict'; markLeaveStale(); render(); return;
    }
    if (r.status === 409 && code === 'OPERATION_REUSE_MISMATCH') { state = 'error'; render(); return; }   // keep op; never auto-retry
    if (r.status === 403) {
      if (phase === 'first') { op = null; state = 'denied'; }   // refused at authorization, never reached the transaction
      else state = 'unknownDenied';                              // keep op: the earlier attempt may have committed
      render(); return;
    }
    if (r.status === 400 && code === 'INVALID_INPUT' && phase === 'first') { op = null; state = 'invalid'; render(); return; }
    state = 'unknown'; render();                                 // network error, timeout, 5xx, UNAVAILABLE, anything else
  }
  /** P4 "查詢結果": receipt of the ORIGINAL operationId. Failure / FORBIDDEN keeps the result unknown. */
  async function queryResult() {
    if (!op || state === 'sending') return;
    const prev = state; state = 'sending'; render();
    const r = await api('/v1/receipt', JSON.stringify({ operationId: op.operationId, workspaceId: cfg.scope.workspaceId }));
    if (r.status === 200 && r.body && r.body.code === 'OK' && r.body.receipt && r.body.receipt.operationId === op.operationId) return finishDone(r.body.receipt);
    state = prev; note = '查詢沒有取得結果（無法存取或暫時無法連線），送出結果仍未確認。'; render();
  }
  function finishDone(receipt) { lastReceipt = receipt; op = null; state = 'done'; render(); loadLeave(); }

  /* ---------------- P4 status rendering (DESIGN §4): label + title + what it means + the safe next step */
  const RESULT = {
    sending: { tag: ['tag-sending', '處理中'], title: '正在送出', text: '請稍候，不要關閉這個頁面。' },
    done: { tag: ['tag-done', '完成'], title: () => `已更正為全天（版本 v${lastReceipt.currentVersion}）`, text: '請假紀錄已重新讀取，顯示的是最新內容。點名狀態沒有改變。' },
    conflict: { tag: ['tag-conflict', '衝突'], title: '資料已被其他裝置更新', text: '這次的更正沒有寫入。請按「重新讀取」看最新內容，再決定是否需要更正。' },
    unknown: { tag: ['tag-unknown', '尚未確認'], title: '送出結果尚未確認', text: '修改可能已經完成，也可能沒有完成。請先按「查詢結果」；查不到時，可以「重新送出同一操作」——它用的是同一個操作編號，不會重複修改。' },
    unknownDenied: { tag: ['tag-unknown', '尚未確認'], title: '先前的送出結果尚未確認，目前無法存取', text: '結果仍然不明，這個頁面現在無法再查詢。開發情境中請停止後重新啟動（重新啟動會回到初始的測試資料）。' },
    denied: { tag: ['tag-denied', '無法存取'], title: '無法存取', text: '沒有送出任何修改。' },
    invalid: { tag: ['tag-denied', '未修改'], title: '內容不符合規定', text: '沒有修改。' },
    error: { tag: ['tag-error', '錯誤'], title: '同一操作的內容不一致', text: '頁面不會自動重試；送出結果尚未確認。請按「查詢結果」。' },
  };
  function render() {
    const card = $('p4'); const region = $('statusRegion'); const actions = $('statusActions');
    updateReviseButton();
    const btn = (text, fn, primary = false) => el('button', { type: 'button', textContent: text, className: primary ? 'primary' : '', onclick: fn });
    const acts = [];
    switch (state) {
      case 'idle': card.hidden = true; card.dataset.state = 'idle'; renderedState = 'idle'; return;
      case 'done': acts.push(btn('關閉', () => { state = 'idle'; render(); $('p2Title').focus(); })); break;
      case 'conflict': acts.push(btn('重新讀取', () => { state = 'idle'; render(); loadLeave().then(() => $('p2Title').focus()); }, true)); break;
      case 'unknown': acts.push(btn('查詢結果', queryResult, true), btn('重新送出同一操作', () => send('resend'))); break;
      case 'denied': acts.push(btn('關閉', () => { state = 'idle'; render(); $('p2Title').focus(); })); break;
      case 'invalid': acts.push(btn('關閉', () => { state = 'idle'; render(); loadLeave().then(() => $('p2Title').focus()); })); break;
      case 'error': acts.push(btn('查詢結果', queryResult)); break;
      case 'sending': case 'unknownDenied': break;
      default: return;
    }
    const R = RESULT[state];
    card.hidden = false; card.dataset.state = state;
    const head = el('p', { className: 'result-head' }, el('span', { className: `tag ${R.tag[0]}`, textContent: R.tag[1] }), el('strong', { className: 'result-title', textContent: typeof R.title === 'function' ? R.title() : R.title }));
    const kids = [head, el('p', { className: 'result-text', textContent: R.text })];
    if (note) kids.push(el('p', { className: 'result-note', textContent: note }));
    if (op) kids.push(el('p', { className: 'receipt', textContent: `操作編號：${op.operationId}` }));
    else if (state === 'done' && lastReceipt) kids.push(el('p', { className: 'receipt', textContent: `收據：${lastReceipt.operationId}` }));
    region.replaceChildren(...kids);
    actions.replaceChildren(...acts);
    region.dataset.state = state;
    // make the outcome noticeable: move focus to the result once per new state (the live region also announces it)
    if (renderedState !== state) {
      renderedState = state;
      const t = $('p4Title'); t.focus({ preventScroll: true });
      card.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ---------------- leaving the page with an unconfirmed operation (best-effort reminder only, SPEC §4-5) */
  window.addEventListener('beforeunload', (e) => {
    if (op && (state === 'unknown' || state === 'unknownDenied' || state === 'sending' || state === 'error')) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------------- dialog keyboard handling: Escape / 返回 close, focus returns, Tab cycles (DESIGN §5) */
  function wireDialog() {
    const d = $('confirmDialog');
    d.addEventListener('close', () => {
      if (op !== null || state !== 'idle') return;   // a submission started: render() moves focus to the result
      if (opener && typeof opener.focus === 'function' && !opener.disabled) opener.focus(); else $('p2Title').focus();
    });
    d.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = [$('confirmButton'), $('cancelButton')].filter((b) => !b.disabled);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    $('cancelButton').addEventListener('click', closeConfirm);
    $('confirmButton').addEventListener('click', confirmAndSend);
    $('reviseButton').addEventListener('click', openConfirm);
  }

  async function init() {
    $('p2Title').tabIndex = -1;
    let scenario = null;
    try { const r = await fetch('/scenario.json', { cache: 'no-store' }); scenario = (await r.json()).scenario; } catch { /* */ }
    cfg = Object.hasOwn(TARGETS, scenario || '') ? TARGETS[scenario] : null;
    if (!cfg) { $('scenarioBanner').textContent = '測試情境：無法辨識｜虛構資料｜暫定色票'; $('dateField').hidden = true; $('p1Body').replaceChildren(denial()); return; }
    $('scenarioBanner').textContent = `測試情境：${scenario}｜虛構資料｜暫定色票`;
    $('devScope').textContent = `測試情境 ${scenario}：工作空間 ${cfg.scope.workspaceId}、班級 ${cfg.scope.classId}${cfg.leave ? `、請假紀錄 ${cfg.leave.leaveRecordId}` : '（只有名冊，唯讀）'}。`;
    document.body.classList.toggle('has-leave', !!cfg.leave);
    const sel = $('sessionSelect');
    for (const s of cfg.sessions) sel.append(el('option', { value: s.sessionId, textContent: s.date }));
    sel.addEventListener('change', loadRoster);
    wireDialog();
    await loadRoster();
    if (cfg.leave) { $('p2').hidden = false; await loadLeave(); }
  }
  init();
})();
