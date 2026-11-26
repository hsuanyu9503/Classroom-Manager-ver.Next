/** Test-only module hook: when dev/stack.mjs imports './world.mjs', give it test/fixtures/mock-world.mjs instead.
 *  Nothing else is redirected. Used only by test/stop.test.mjs (fault injection, no emulator, no network). */
export async function resolve(specifier, context, next) {
  if (specifier === './world.mjs' && context.parentURL && context.parentURL.endsWith('/dev/stack.mjs')) {
    return { url: new URL('./mock-world.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
