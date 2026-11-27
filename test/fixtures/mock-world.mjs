/** Test-only stand-in for dev/world.mjs (no emulator, no network). MOCK_STOP selects the injected fault:
 *  ok | hang-stop | hang-cleanup | throw-stop | throw-cleanup-running | throw-cleanup-gone */
const mode = process.env.MOCK_STOP || 'ok';
const never = () => new Promise(() => {});
export async function openUpstream() {
  return {
    close: async () => {
      if (mode === 'hang-cleanup') return never();
      if (mode.startsWith('throw-cleanup')) throw new Error('injected: owned cleanup failed');
      console.log('MOCK cleanup done');
    },
    emulatorsGone: async () => mode === 'throw-cleanup-gone',
  };
}
export async function startScenario() {
  return {
    url: 'http://127.0.0.1:0/',
    stop: async () => {
      if (mode === 'hang-stop') return never();
      if (mode === 'throw-stop') throw new Error('injected: stack stop failed');
    },
  };
}
export const LOGIN_SCENARIO = 'LOGIN';
export async function startLogin() { throw new Error('mock-world: LOGIN is not used by the stop tests'); }
