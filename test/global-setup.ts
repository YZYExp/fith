import sparticuz from '@sparticuz/chromium';

/**
 * Resolve the bundled Chromium ONCE, before any worker starts. Every test file
 * otherwise calls `sparticuz.executablePath()` concurrently from its own worker;
 * each call (re)extracts the binary to /tmp/chromium, so one worker can be
 * writing it while another spawns it → `spawn ETXTBSY` flakes in CI. Workers
 * inherit CHROMIUM_PATH (all tests already prefer it over sparticuz).
 */
export default async function setup() {
  if (!process.env.CHROMIUM_PATH) process.env.CHROMIUM_PATH = await sparticuz.executablePath();
}
