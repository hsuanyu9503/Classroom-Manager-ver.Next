/* W1 page logic. SPEC §2 (pages), §4 (submission outcomes), §5 (nothing persisted in the browser).
   The page holds no token: the local proxy adds it (SPEC §3). The only memory is the current frozen operation. */
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
  /** The frozen operation (SPEC §4-1): operationId + the COMPLETE request body, created once, never rebuilt. */
  let op = null;             // { operationId, bodyText, expectedVersion }
  let state = 'idle';        // idle | sending | done | conflict | unknown | unknownDenied | denied | invalid | error
  let note = '';
  let lastReceipt = null;

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
  const unavailable = (retry) => el('div', {}, el('p', { textContent: '目前無法讀取，請稍後再試。' }), el('button', { type: 'button', textContent: '重試', onclick: retry }));

  /* ---------------- P1 roster and summary */
  async function loadRoster() {
    const sessionId = $('sessionSelect').value;
    const body = $('p1Body'); body.replaceChildren(el('p', { className: 'muted', textContent: '讀取中…' }));
    const [ses, sum] = await Promise.all([read('attendanceSession.read', { sessionId }), read('attendanceSummary.read', { sessionId })]);
    if (ses.status === 403 || sum.status === 403) return body.replaceChildren(denial());
    if (!isOk(ses) || !isOk(sum)) return body.replaceChildren(unavailable(loadRoster));
    const c = sum.body.data.counts;
    const dl = el('dl', { className: 'summary' });
    for (const [k, v] of [['P', c.P], ['R', c.R], ['N', c.N], ['U', c.U], ['合計', c.total], ['已到（P+R）', c.arrived], ['已登記（P+R+N）', c.registered]]) dl.append(el('div', {}, el('dt', { textContent: k }), el('dd', { textContent: String(v) })));
    const seat = new Map(ses.body.data.rosterSnapshot.map((r) => [r.enrollmentId, r.seatNo]));
    const rows = ses.body.data.entries.map((e) => ({ seat: seat.get(e.enrollmentId), status: e.status })).sort((a, b) => (a.seat ?? 1e9) - (b.seat ?? 1e9));
    const table = el('table', { className: 'roster' });
    table.append(el('caption', { className: 'muted', textContent: `${$('sessionSelect').selectedOptions[0].textContent}，共 ${rows.length} 筆（姓名不在受控 API 的回應中）` }));
    const thead = el('thead'); thead.append(el('tr', {}, el('th', { scope: 'col', textContent: '座號' }), el('th', { scope: 'col', textContent: '狀態代碼' })));
    const tbody = el('tbody');
    for (const r of rows) {
      const a = el('td', { textContent: r.seat == null ? '—' : String(r.seat) }); a.dataset.label = '座號';
      const b = el('td', { textContent: r.status }); b.dataset.label = '狀態代碼';
      tbody.append(el('tr', {}, a, b));
    }
    table.append(thead, tbody);
    body.replaceChildren(dl, table);
  }

  /* ---------------- P2 leave summary */
  async function loadLeave() {
    const body = $('p2Body'); body.replaceChildren(el('p', { className: 'muted', textContent: '讀取中…' }));
    leave = null; updateReviseButton();
    const r = await read('leaveRecord.read', { leaveRecordId: cfg.leave.leaveRecordId });
    if (r.status === 403) return body.replaceChildren(denial());
    if (!isOk(r)) return body.replaceChildren(unavailable(loadLeave));
    leave = r.body.data;
    const segs = leave.coverageSegments || [];
    const part = segs.length === 1 ? (DAYPART[segs[0].dayPart] || segs[0].dayPart) : `${segs.length} 個時段`;
    const dl = el('dl', { className: 'leave' });
    for (const [k, v] of [['請假紀錄', leave.leaveRecordId], ['假別', leave.leaveTypeId], ['涵蓋時段', part], ['版本', `v${leave.version}`]]) dl.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
    body.replaceChildren(dl);
    updateReviseButton();
  }
  /** After a conflict the shown record is outdated: drop it (so nothing can be frozen from it) and say so. Only a
   *  successful loadLeave() sets `leave` again; a failed or refused re-read leaves it null. */
  function markLeaveStale() {
    leave = null;
    $('p2Body').append(el('p', { className: 'stale', textContent: '以上內容已不是最新，請先重新讀取。' }));
  }
  const canRevise = () => !!leave && (leave.coverageSegments || []).length === 1 && leave.coverageSegments[0].dayPart === 'AM' && op === null && state !== 'sending' && state !== 'conflict';
  function updateReviseButton() { $('reviseButton').disabled = !canRevise(); }

  /* ---------------- P3 confirm → freeze → send */
  let opener = null;
  function openConfirm() {
    if (!canRevise()) return;
    opener = document.activeElement;
    $('confirmText').textContent = `將請假紀錄 ${leave.leaveRecordId} 的涵蓋時段由「上午」更正為「全天」。目前版本：v${leave.version}。`;
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

  /* ---------------- P4 status rendering (DESIGN §4) */
  function render() {
    const card = $('p4'); const region = $('statusRegion'); const actions = $('statusActions');
    updateReviseButton();
    const btn = (text, fn, primary = false) => el('button', { type: 'button', textContent: text, className: primary ? 'primary' : '', onclick: fn });
    let tag = null; let text = ''; const acts = [];
    switch (state) {
      case 'idle': card.hidden = true; return;
      case 'sending': tag = ['tag-unknown', '處理中']; text = '正在送出，請稍候。'; break;
      case 'done': tag = ['tag-done', '完成']; text = `已更正為全天（版本 v${lastReceipt.currentVersion}）。收據：${lastReceipt.operationId}`; acts.push(btn('關閉', () => { state = 'idle'; render(); })); break;
      case 'conflict': tag = ['tag-conflict', '衝突']; text = '資料已被其他裝置更新，請確認最新內容後再決定是否更正。'; acts.push(btn('重新讀取', () => { state = 'idle'; render(); loadLeave(); }, true)); break;
      case 'unknown': tag = ['tag-unknown', '尚未確認']; text = '送出結果尚未確認。修改可能已經完成，也可能沒有完成。'; acts.push(btn('查詢結果', queryResult, true), btn('重新送出同一操作', () => send('resend'))); break;
      case 'unknownDenied': tag = ['tag-unknown', '尚未確認']; text = '先前的送出結果尚未確認，目前無法存取。'; break;
      case 'denied': tag = ['tag-denied', '無法存取']; text = '無法存取。'; acts.push(btn('關閉', () => { state = 'idle'; render(); })); break;
      case 'invalid': tag = ['tag-denied', '未修改']; text = '內容不符合規定，沒有修改。'; acts.push(btn('關閉', () => { state = 'idle'; render(); loadLeave(); })); break;
      case 'error': tag = ['tag-denied', '錯誤']; text = '頁面發生錯誤：同一操作的內容不一致。不會自動重試；送出結果尚未確認。'; acts.push(btn('查詢結果', queryResult)); break;
      default: return;
    }
    card.hidden = false;
    const p = el('p', {}, el('span', { className: `tag ${tag[0]}`, textContent: tag[1] }), text);
    const kids = [p];
    if (note) kids.push(el('p', { className: 'muted', textContent: note }));
    if (op) kids.push(el('p', { className: 'receipt', textContent: `操作編號：${op.operationId}` }));
    region.replaceChildren(...kids);
    actions.replaceChildren(...acts);
    region.dataset.state = state;
  }

  /* ---------------- leaving the page with an unconfirmed operation (best-effort reminder only, SPEC §4-5) */
  window.addEventListener('beforeunload', (e) => {
    if (op && (state === 'unknown' || state === 'unknownDenied' || state === 'sending' || state === 'error')) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------------- dialog keyboard handling: Escape / 返回 close, focus returns, Tab cycles (DESIGN §5) */
  function wireDialog() {
    const d = $('confirmDialog');
    d.addEventListener('close', () => { if (opener && typeof opener.focus === 'function' && !opener.disabled) opener.focus(); else $('p2Title').focus(); });
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
    if (!cfg) { $('scenarioBanner').textContent = '測試情境：無法辨識｜虛構資料｜暫定色票'; $('p1Body').replaceChildren(denial()); return; }
    $('scenarioBanner').textContent = `測試情境：${scenario}｜虛構資料｜暫定色票`;
    const sel = $('sessionSelect');
    for (const s of cfg.sessions) sel.append(el('option', { value: s.sessionId, textContent: s.date }));
    sel.addEventListener('change', loadRoster);
    wireDialog();
    await loadRoster();
    if (cfg.leave) { $('p2').hidden = false; await loadLeave(); }
  }
  init();
})();
