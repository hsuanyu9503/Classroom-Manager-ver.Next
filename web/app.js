/* W1 page logic. SPEC §2 (pages), §4 (submission outcomes), §5 (storage), §11 (Google sign-in).
   Two modes, chosen by the local proxy (/scenario.json):
   - actor (test scenarios): the page holds no token; the proxy adds the scenario actor's token.
   - login (Google sign-in): Firebase Authentication (SDK, session persistence) holds the SIGNED-IN USER's token;
     every API call carries that user's own ID token; the API verifies it and authorizes every request.
     Signing in only proves identity: what the user may read is decided by the backend's bindings.
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
  /** login mode: the W1 classes of the fictional world. The page only ASKS; the API decides which ones this user may
   *  read (a class the user is not bound to answers 403 and is never shown). Identifiers only. */
  const LOGIN_CLASSES = [TARGETS['S-LEAVE-SC01'], TARGETS['S-ROSTER-A17']];
  const DAYPART = { AM: '上午', PM: '下午', FULL_DAY: '全天' };
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, props); for (const k of kids) n.append(k); return n; };

  let mode = 'actor';        // actor | login
  let fb = null;             // the bundled Firebase Auth SDK (login mode only)
  let auth = null;
  let user = null;           // the signed-in Firebase user (login mode)
  let epoch = 0;             // +1 on every account change: results that arrive for an older epoch are dropped
  /** an unconfirmed operation of ANOTHER account, kept in memory only; never sent or queried with the current
   *  account; restored when the same account signs in again in this tab */
  let parked = null;         // { op, state, note }
  let loginNotice = '';
  let loggingOut = false;    // true only while the user's own 登出 runs
  let loginConf = null;
  let cfg = null;
  let leave = null;          // last leave record read from the API
  let leaveState = 'none';   // none | loading | ok | denied | unavailable | stale  (for the hint only)
  /** The frozen operation (SPEC §4-1): operationId + the COMPLETE request body, created once, never rebuilt. */
  let op = null;             // { operationId, bodyText, expectedVersion, uid }  (uid: the account that created it)
  let state = 'idle';        // idle | sending | done | conflict | unknown | unknownDenied | denied | invalid | error
  let note = '';
  let lastReceipt = null;
  let renderedState = 'idle';

  /** status 'NO_SESSION': no usable sign-in (handled, show nothing); 'STALE': the account changed meanwhile (drop) */
  async function api(path, bodyText) {
    const my = epoch;
    const headers = { 'content-type': 'application/json' };
    if (mode === 'login') {
      if (!user) return { status: 'NO_SESSION', body: null };
      let t = null;
      try { t = await user.getIdToken(); } catch (e) { if (my === epoch) sessionInvalid(e); return { status: 'NO_SESSION', body: null }; }
      if (my !== epoch) return { status: 'STALE', body: null };
      headers.authorization = `Bearer ${t}`;
    }
    let out;
    try {
      const r = await fetch(path, { method: 'POST', headers, body: bodyText, cache: 'no-store', credentials: 'same-origin' });
      let body = null; try { body = await r.json(); } catch { /* non-JSON */ }
      out = { status: r.status, body };
    } catch { out = { status: 0, body: null }; }   // network error / connection lost
    return my === epoch ? out : { status: 'STALE', body: null };
  }
  const dropped = (r) => r.status === 'STALE' || r.status === 'NO_SESSION';
  const read = (opName, target, scope = cfg.scope) => api('/v1/read', JSON.stringify({ op: opName, target, claimedScope: scope }));
  const isOk = (r) => r.status === 200 && r.body && r.body.code === 'OK';
  const denial = () => el('p', { className: 'denied' }, el('span', { className: 'tag tag-denied', textContent: '無法存取' }), '無法存取。');
  const unavailable = (retry) => el('div', { className: 'unavailable' }, el('p', { textContent: '目前無法讀取，請稍後再試。' }), el('button', { type: 'button', textContent: '重試', onclick: retry }));
  const stat = (k, v, cls = '') => el('div', { className: cls }, el('dt', { textContent: k }), el('dd', { textContent: String(v) }));

  /* ---------------- P1 roster and summary */
  async function loadRoster() {
    const sessionId = $('sessionSelect').value;
    const body = $('p1Body'); body.replaceChildren(el('p', { className: 'loading', textContent: '讀取中…' }));
    const [ses, sum] = await Promise.all([read('attendanceSession.read', { sessionId }), read('attendanceSummary.read', { sessionId })]);
    if (dropped(ses) || dropped(sum)) return undefined;
    if (ses.status === 403 || sum.status === 403) { $('dateField').hidden = true; body.replaceChildren(denial()); return recheckAccess(); }
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
    if (dropped(r)) return undefined;
    if (r.status === 403) { leaveState = 'denied'; updateReviseButton(); body.replaceChildren(denial()); refreshDoneText(); return recheckAccess(); }
    if (!isOk(r)) { leaveState = 'unavailable'; updateReviseButton(); body.replaceChildren(unavailable(loadLeave)); return refreshDoneText(); }
    leave = r.body.data; leaveState = 'ok';
    const segs = leave.coverageSegments || [];
    const part = segs.length === 1 ? (DAYPART[segs[0].dayPart] || segs[0].dayPart) : `${segs.length} 個時段`;
    const now = el('div', { className: 'leave-now' }, el('span', { className: 'leave-now-label', textContent: '涵蓋時段' }), el('span', { className: `daypart daypart-${segs.length === 1 ? segs[0].dayPart : 'MULTI'}`, textContent: part }));
    const dl = el('dl', { className: 'leave' });
    for (const [k, v] of [['請假紀錄', leave.leaveRecordId], ['假別', leave.leaveTypeId], ['版本', `v${leave.version}`]]) dl.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
    body.replaceChildren(now, dl);
    updateReviseButton();
    refreshDoneText();
  }
  /** the 'done' text describes the re-read as it actually is (WEB5-REV-001); the receipt itself stays valid */
  function refreshDoneText() { if (state === 'done') render(); }
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
    return Object.freeze({ operationId, expectedVersion: leave.version, bodyText: JSON.stringify({ command, claimedScope: cfg.scope }), uid: mode === 'login' ? user.uid : null, scope: cfg.scope });
  }
  async function confirmAndSend() {
    if (state === 'sending' || op !== null) return;           // double activation reuses nothing new
    $('confirmButton').disabled = true;
    op = freezeOperation();
    closeConfirm();
    await send('first');
  }
  /** One submission of the FROZEN operation. phase: 'first' (just confirmed) | 'resend' (after an unknown result). */
  const ownOp = () => !!op && (mode !== 'login' || (!!user && op.uid === user.uid));
  async function send(phase) {
    if (!op || state === 'sending' || !ownOp()) return;   // never sent with another account
    state = 'sending'; note = ''; render();
    const r = await api('/v1/commit', op.bodyText);
    if (dropped(r)) return;                              // account changed while sending: parked as unknown (onUser)
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
    if (!op || state === 'sending' || !ownOp()) return;
    const prev = state; state = 'sending'; render();
    const r = await api('/v1/receipt', JSON.stringify({ operationId: op.operationId, workspaceId: op.scope.workspaceId }));
    if (dropped(r)) return;
    if (r.status === 200 && r.body && r.body.code === 'OK' && r.body.receipt && r.body.receipt.operationId === op.operationId) return finishDone(r.body.receipt);
    state = prev; note = '查詢沒有取得結果（無法存取或暫時無法連線），送出結果仍未確認。'; render();
  }
  function finishDone(receipt) { lastReceipt = receipt; op = null; state = 'done'; leaveState = 'loading'; render(); loadLeave(); }

  /* ---------------- P4 status rendering (DESIGN §4): label + title + what it means + the safe next step */
  const RESULT = {
    sending: { tag: ['tag-sending', '處理中'], title: '正在送出', text: '請稍候，不要關閉這個頁面。' },
    // the receipt proves the correction; the text about the leave record follows the re-read that comes after it
    done: { tag: ['tag-done', '完成'], title: () => `已更正為全天（版本 v${lastReceipt.currentVersion}）`, text: () => ({
      loading: '這次請假更正已完成。正在重新讀取請假紀錄…',
      ok: '這次請假更正已完成；上方的請假紀錄已重新讀取，是最新內容。點名狀態沒有改變。',
    }[leaveState] || '這次請假更正已完成（見下方收據），但重新讀取請假紀錄沒有成功，上方顯示的不是最新內容。點名狀態沒有改變。') },
    conflict: { tag: ['tag-conflict', '衝突'], title: '資料已被其他裝置更新', text: '這次的更正沒有寫入。請按「重新讀取」看最新內容，再決定是否需要更正。' },
    unknown: { tag: ['tag-unknown', '尚未確認'], title: '送出結果尚未確認', text: '修改可能已經完成，也可能沒有完成。請先按「查詢結果」；查不到時，可以「重新送出同一操作」——它用的是同一個操作編號，不會重複修改。' },
    unknownDenied: { tag: ['tag-unknown', '尚未確認'], title: '先前的送出結果尚未確認，目前無法存取', text: '結果仍然不明，這個頁面現在無法再查詢。開發情境中請停止後重新啟動（重新啟動會回到初始的測試資料）。' },
    denied: { tag: ['tag-denied', '無法存取'], title: '無法存取', text: '這次更正未獲允許，沒有修改資料。' },
    invalid: { tag: ['tag-denied', '未修改'], title: '內容不符合規定', text: '沒有修改。' },
    error: { tag: ['tag-error', '錯誤'], title: '同一操作的內容不一致', text: '頁面不會自動重試；送出結果尚未確認。請按「查詢結果」。' },
  };
  function render() {
    const card = $('p4'); const region = $('statusRegion'); const actions = $('statusActions');
    updateReviseButton();
    if (mode === 'login') { $('logoutButton').disabled = state === 'sending'; $('classSelect').disabled = op !== null; }
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
    const kids = [head, el('p', { className: 'result-text', textContent: typeof R.text === 'function' ? R.text() : R.text })];
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
  const unconfirmed = () => !!op && ['unknown', 'unknownDenied', 'sending', 'error'].includes(state);
  window.addEventListener('beforeunload', (e) => {
    if (unconfirmed() || parked) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------------- login mode (SPEC §11): gate screens, account bar, account changes */
  const show = (id, on) => { $(id).hidden = !on; };
  function showGate(kind, extra = '') {
    show('gate', true); show('p1', false); show('side', false); show('classBar', false);
    const btn = (text, fn, primary = false, id = '') => el('button', { type: 'button', textContent: text, className: primary ? 'primary' : '', onclick: fn, ...(id ? { id } : {}) });
    const G = {
      checking: ['正在確認登入狀態…', extra || '請稍候。', []],
      login: ['請先登入', '使用 Google 帳號登入後，才會顯示你有權限的班級資料。登入只確認你是誰，不會自動取得任何班級權限。', [btn('使用 Google 登入', signIn, true, 'loginButton')]],
      noAccess: ['尚未取得班級存取權', `你已用 ${user?.email || '這個帳號'} 登入，但這個帳號${extra === 'revoked' ? '目前沒有（或已不再有）' : '還沒有'}被授權存取任何班級，所以不會顯示班級資料。請聯絡管理者授權；授權後按「重新檢查」。`, [btn('重新檢查', () => enterClass(true), true, 'recheckButton'), btn('登出', logout)]],
    }[kind];
    $('gate').dataset.kind = kind;
    $('gateTitle').textContent = G[0];
    const kids = [el('p', { textContent: G[1] })];
    // the account's Firebase UID (an identifier, not a secret) so the owner can bind it with server/admin.mjs
    if (kind === 'noAccess' && user) kids.push(el('p', { className: 'gate-uid' }, '提供給管理者的帳號識別碼（UID）：', el('code', { id: 'gateUid', textContent: user.uid })));
    if (kind === 'login' && loginNotice) kids.unshift(el('p', { className: 'gate-notice', id: 'loginNotice', textContent: loginNotice }));
    $('gateBody').replaceChildren(...kids);
    $('gateActions').replaceChildren(...G[2]);
    renderParked();
  }
  function showData() { show('gate', false); show('p1', true); show('side', true); renderParked(); }
  function renderParked() {
    const on = mode === 'login' && !!parked && (!user || parked.op.uid !== user.uid);
    show('parkedNotice', on);
    if (on) $('parkedNotice').textContent = '這個分頁中，先前的帳號有一個送出結果尚未確認的操作。它不會用目前的帳號查詢或重送；請改用原本的帳號登入後再確認結果。';
  }
  function renderAccount() {
    show('authBar', mode === 'login' && !!user);
    if (user) { $('authUser').textContent = user.displayName ? `${user.displayName}（${user.email || ''}）` : (user.email || '已登入'); }
    $('logoutButton').disabled = state === 'sending';
  }
  /** wipe everything the previous account saw (data, selections, results); keeps nothing in the DOM */
  function clearData() {
    cfg = null; leave = null; leaveState = 'none'; lastReceipt = null; note = ''; state = 'idle'; op = null; renderedState = 'idle';
    $('p1Body').replaceChildren(); $('p2Body').replaceChildren(); $('statusRegion').replaceChildren(); $('statusActions').replaceChildren();
    $('statusRegion').dataset.state = 'idle'; $('p4').dataset.state = 'idle';
    $('devScope').textContent = '班級：尚未選擇。';
    $('classOnly').textContent = ''; show('classBar', false);
    $('sessionSelect').replaceChildren(); $('classSelect').replaceChildren();
    show('p4', false); show('p2', false); show('reviseBox', false); $('dateField').hidden = false;
    document.body.classList.remove('has-leave');
  }
  async function onUser(u) {
    epoch += 1;
    const prevUid = user ? user.uid : null; const nextUid = u ? u.uid : null;
    // an operation of the previous account is parked, never handed to the next one
    if (op && op.uid !== nextUid) parked = { op, state: state === 'sending' ? 'unknown' : state, note };
    clearData();
    user = u; renderAccount();
    if (parked && nextUid && parked.op.uid === nextUid) { op = parked.op; state = parked.state; note = parked.note; parked = null; }
    if (!u) {
      // signed out without the user asking (e.g. the SDK found the account disabled / the session revoked)
      if (prevUid && !loggingOut && !loginNotice) loginNotice = '登入已失效，請重新登入。';
      loggingOut = false;
      showGate('login'); return;
    }
    if (prevUid !== nextUid) loginNotice = '';
    await enterClass(false);
  }
  /** which W1 classes may this account read? (the API decides; nothing is shown before it answers) */
  async function probeClasses() {
    const ok = [];
    for (const c of LOGIN_CLASSES) {
      const r = await read('attendanceSession.read', { sessionId: c.sessions[0].sessionId }, c.scope);
      if (dropped(r)) return null;
      if (isOk(r)) ok.push(c);
    }
    return ok;
  }
  async function enterClass(forceRefresh) {
    const my = epoch;
    showGate('checking', '正在確認你的班級存取權…');
    if (forceRefresh) { try { await checkSession(); } catch (e) { if (my === epoch) sessionInvalid(e); return; } }
    const acc = await probeClasses();
    if (acc === null || my !== epoch) return;
    if (!acc.length) { showGate('noAccess'); return; }
    const sel = $('classSelect'); sel.replaceChildren();
    for (const c of acc) sel.append(el('option', { value: c.scope.classId, textContent: c.scope.classId }));
    show('classBar', true);                              // always show which class this account is using
    sel.hidden = acc.length === 1; $('classOnly').hidden = acc.length !== 1;
    $('classOnly').textContent = `${acc[0].scope.classId}（工作空間 ${acc[0].scope.workspaceId}）`;
    const pick = (op && acc.find((c) => c.scope.classId === op.scope.classId)) || acc[0];
    sel.value = pick.scope.classId;
    await selectClass(pick);
  }
  async function selectClass(c) {
    cfg = c; leave = null; leaveState = 'none';
    $('p1Body').replaceChildren(); $('p2Body').replaceChildren();
    document.body.classList.toggle('has-leave', !!c.leave);
    const sel = $('sessionSelect'); sel.replaceChildren();
    for (const s of c.sessions) sel.append(el('option', { value: s.sessionId, textContent: s.date }));
    $('classSelect').disabled = op !== null;            // never switch class under an unconfirmed operation
    $('devScope').textContent = `班級 ${c.scope.classId}（工作空間 ${c.scope.workspaceId}）${c.leave ? `、請假紀錄 ${c.leave.leaveRecordId}` : '（只有名冊，唯讀）'}。`;
    show('p2', !!c.leave);
    showData();
    render();
    await loadRoster();
    if (c.leave && cfg === c) await loadLeave();
  }
  /** is the sign-in still usable? reload() asks the Auth service about the account (disabled / deleted fails here,
   *  even where a token refresh would still be issued); then a fresh ID token (newer iat, e.g. after a new binding) */
  async function checkSession() { await user.reload(); await user.getIdToken(true); }
  /** a 403 while reading in login mode: is the sign-in still valid? is the access still there? (revocation) */
  let rechecking = false;
  async function recheckAccess() {
    if (mode !== 'login' || rechecking || !user) return;
    rechecking = true; const my = epoch;
    try {
      try { await checkSession(); } catch (e) { if (my === epoch) sessionInvalid(e); return; }
      if (my !== epoch) return;
      const acc = await probeClasses();
      if (acc === null || my !== epoch) return;
      if (cfg && acc.some((c) => c.scope.classId === cfg.scope.classId)) return;   // still allowed: keep the denial shown
      if (op) return;                                    // an unconfirmed operation of this account stays visible
      clearData(); renderAccount();
      if (!acc.length) showGate('noAccess', 'revoked'); else await enterClass(false);
    } finally { rechecking = false; }
  }
  /** the sign-in cannot be used any more (disabled account, expired / revoked session): sign out, say why */
  function sessionInvalid(e) {
    loginNotice = `登入已失效，請重新登入${e && e.code ? `（${e.code}）` : ''}。`;
    epoch += 1;
    if (op) parked = { op, state: state === 'sending' ? 'unknown' : state, note };
    clearData();
    fb.signOut(auth).catch(() => {});
    showGate('login');
  }
  const LOGIN_ERRORS = {
    'auth/popup-closed-by-user': '已取消登入，沒有任何變更。',
    'auth/cancelled-popup-request': '已取消登入，沒有任何變更。',
    'auth/user-cancelled': '已取消登入，沒有任何變更。',
    'auth/popup-blocked': '瀏覽器擋下了登入視窗。請允許這個網站開啟彈出視窗後，再試一次。',
    'auth/network-request-failed': '無法連線到登入服務，請稍後再試。',
    'auth/user-disabled': '這個帳號已被停用，無法登入。',
  };
  const busy = () => { const b = $('loginButton'); if (b) { b.disabled = true; b.textContent = '登入中…'; } const n = $('loginNotice'); if (n) n.remove(); };
  const failed = (e) => { loginNotice = LOGIN_ERRORS[e && e.code] || `登入沒有成功，請再試一次${e && e.code ? `（${e.code}）` : ''}。`; if (!user) showGate('login'); };
  async function signIn() {
    loginNotice = '';
    if (loginConf.authEmulator) return openAccountChooser();
    // REAL Google sign-in (a development Firebase project). NOT used with the emulator: the SDK's popup loads
    // https://apis.google.com, which needs a CSP exception that is not approved yet (SPEC §11.6).
    busy();
    try {
      const provider = new fb.GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
      await fb.signInWithPopup(auth, provider);          // success continues in onAuthStateChanged → onUser
    } catch (e) { failed(e); }
  }
  /** EMULATOR ONLY: choose a fictional account; the Auth Emulator accepts its documented fake Google credential and
   *  issues an emulator ID token for that Google-provider account. This is a simulated sign-in, not Google. */
  function openAccountChooser() {
    const d = $('accountDialog'); let chosen = null;
    const pickBtn = (acc, isNew = false) => el('button', { type: 'button', className: isNew ? 'acc-new' : '', onclick: () => { chosen = acc; d.close(); } },
      el('span', { textContent: acc.name }), el('span', { className: 'acc-email', textContent: acc.email }));
    const fresh = { email: `new-${crypto.randomUUID().slice(0, 8)}@example.test`, name: '新的虛構帳號（沒有任何授權）' };
    $('accountList').replaceChildren(...loginConf.emulatorAccounts.map((a) => pickBtn(a)), pickBtn(fresh, true));
    d.onclose = () => {
      d.onclose = null;
      if (!chosen) { loginNotice = '已取消登入，沒有任何變更。'; showGate('login'); return; }
      emulatorSignIn(chosen);
    };
    d.showModal();
    const first = $('accountList').querySelector('button'); if (first) first.focus();
  }
  async function emulatorSignIn(acc) {
    busy();
    try {
      const cred = fb.GoogleAuthProvider.credential(JSON.stringify({ sub: `fictional-${acc.email}`, email: acc.email, email_verified: true, name: acc.name }));
      await fb.signInWithCredential(auth, cred);         // success continues in onAuthStateChanged → onUser
    } catch (e) { failed(e); }
  }
  async function logout() {
    if (state === 'sending') return;
    if (unconfirmed() && !window.confirm('還有一個送出結果尚未確認的操作。登出後，這個分頁會保留它，但只有用同一個帳號重新登入後才能查詢結果。確定要登出嗎？')) return;
    loginNotice = '已登出。'; loggingOut = true;
    await fb.signOut(auth);                              // → onAuthStateChanged(null) → onUser(null)
  }
  async function initLogin(conf) {
    mode = 'login'; loginConf = conf;
    $('accountCancel').addEventListener('click', () => $('accountDialog').close());
    $('scenarioBanner').textContent = conf.authEmulator ? '登入模式：Google 模擬登入（本機 Auth Emulator）｜虛構資料｜暫定色票' : `登入模式：Google（開發用 Firebase 專案 ${conf.projectLabel || ''}）｜虛構資料｜暫定色票`;
    $('devLogin').hidden = false;
    if (!conf.authEmulator) $('devLogin').textContent = '登入使用真實的 Google 帳號（開發用 Firebase 專案）。登入只確認身分；能看哪個班級，由後端的授權綁定決定。登入狀態由 Firebase SDK 保存在這個分頁的 sessionStorage，關閉分頁就會登出。資料仍然只有虛構測資。';
    $('logoutButton').addEventListener('click', logout);
    $('classSelect').addEventListener('change', () => { const c = LOGIN_CLASSES.find((x) => x.scope.classId === $('classSelect').value); if (c && op === null) selectClass(c); });
    showGate('checking');
    try {
      fb = await import('/vendor/firebase-auth.js');
      const app = fb.initializeApp(conf.firebase);
      // the SDK keeps the sign-in for THIS TAB only (sessionStorage), so a reload keeps it and closing the tab ends it
      // the popup resolver is only attached for REAL Google sign-in (it loads https://apis.google.com)
      auth = fb.initializeAuth(app, { persistence: fb.browserSessionPersistence, ...(conf.authEmulator ? {} : { popupRedirectResolver: fb.browserPopupRedirectResolver }) });
      if (conf.authEmulator) fb.connectAuthEmulator(auth, conf.authEmulator, { disableWarnings: true });
    } catch {
      showGate('checking', '無法載入登入元件，請重新整理頁面。'); return;
    }
    let first = true;
    const t = setTimeout(() => { if (first) { loginNotice = '無法確認登入狀態，請重新整理頁面或重新登入。'; showGate('login'); } }, 15000);
    fb.onAuthStateChanged(auth, (u) => { first = false; clearTimeout(t); onUser(u); });
  }

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
    let scenario = null; let conf = null;
    try { const r = await fetch('/scenario.json', { cache: 'no-store' }); conf = await r.json(); scenario = conf.scenario; } catch { /* */ }
    wireDialog();
    $('sessionSelect').addEventListener('change', loadRoster);
    if (conf && conf.mode === 'login') return initLogin(conf);
    cfg = Object.hasOwn(TARGETS, scenario || '') ? TARGETS[scenario] : null;
    if (!cfg) { $('scenarioBanner').textContent = '測試情境：無法辨識｜虛構資料｜暫定色票'; $('dateField').hidden = true; $('p1Body').replaceChildren(denial()); return; }
    $('scenarioBanner').textContent = `測試情境：${scenario}｜虛構資料｜暫定色票`;
    $('devScope').textContent = `測試情境 ${scenario}：工作空間 ${cfg.scope.workspaceId}、班級 ${cfg.scope.classId}${cfg.leave ? `、請假紀錄 ${cfg.leave.leaveRecordId}` : '（只有名冊，唯讀）'}。`;
    document.body.classList.toggle('has-leave', !!cfg.leave);
    const sel = $('sessionSelect');
    for (const s of cfg.sessions) sel.append(el('option', { value: s.sessionId, textContent: s.date }));
    await loadRoster();
    if (cfg.leave) { $('p2').hidden = false; await loadLeave(); }
  }
  init();
})();
