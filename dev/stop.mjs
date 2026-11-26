/** The stack's stop outcome (WEB3-REV-001). Only a COMPLETED stop with completed owned cleanup is a success.
 *
 *  outcome          exit  meaning
 *  CLEAN            0     web proxy + upstream stack stopped, owned emulator data cleared
 *  EMULATORS_GONE   0     stack stopped; the owned cleanup failed BECAUSE the emulators had already stopped, and that
 *                         was confirmed afterwards (their ports are closed). Emulator data lives in memory only (no
 *                         export is configured), so it is gone with them. Any other cleanup failure is an error.
 *  STOP_TIMEOUT     4     the stop did not finish within the time limit
 *  STOP_ERROR       5     stopping the web proxy / upstream stack failed
 *  CLEANUP_ERROR    5     the owned cleanup failed while the emulators were still (or possibly) running
 */
export const STOP_EXIT = Object.freeze({ CLEAN: 0, EMULATORS_GONE: 0, STOP_TIMEOUT: 4, STOP_ERROR: 5, CLEANUP_ERROR: 5 });
export const STOP_TIMEOUT_MS = 15000;   // below the launcher's first escalation (20 s)

const msg = (e) => String(e?.message || e).split('\n')[0].slice(0, 300);
const timeout = (ms, value) => new Promise((r) => { setTimeout(() => r(value), ms); });

/** @param steps.stopStack     () => Promise — stop the web proxy and the upstream stack
 *  @param steps.ownedCleanup  () => Promise — ownership check + clear the owned emulator data
 *  @param steps.emulatorsGone () => Promise<boolean> — true only if every emulator port is confirmed closed
 *  @returns {Promise<{ outcome, code, detail }>} — never throws */
export async function runStop({ stopStack, ownedCleanup, emulatorsGone }, { timeoutMs = STOP_TIMEOUT_MS } = {}) {
  const result = (outcome, detail = '') => ({ outcome, code: STOP_EXIT[outcome], detail });
  const work = (async () => {
    try { await stopStack(); } catch (e) { return result('STOP_ERROR', `stopping the web proxy / upstream stack failed: ${msg(e)}`); }
    try { await ownedCleanup(); return result('CLEAN'); } catch (e) {
      let gone = false;
      try { gone = (await Promise.race([emulatorsGone(), timeout(3000, false)])) === true; } catch { gone = false; }
      if (gone) return result('EMULATORS_GONE', `owned cleanup not possible (${msg(e)}); confirmed afterwards: the emulator ports are closed, so their in-memory data is gone`);
      return result('CLEANUP_ERROR', `owned cleanup failed and the emulators are not confirmed stopped: ${msg(e)}`);
    }
  })();
  // a real (ref'd) timer: it must fire even when nothing else keeps the process alive; cleared once the work ends
  let timer;
  const limit = new Promise((r) => { timer = setTimeout(() => r(result('STOP_TIMEOUT', `the stop did not finish within ${timeoutMs} ms`)), timeoutMs); });
  try { return await Promise.race([work, limit]); } finally { clearTimeout(timer); }
}
