/** Best-effort E2E smoke for the unpacked extension: load it, trigger a full-page
 * capture from the service worker, and confirm a download + preview tab result. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sparticuz from '@sparticuz/chromium';

const EXT = resolve('dist/extension');
const FIXTURE = pathToFileURL(resolve('test/fixtures/smoke.html')).href;

async function main() {
  const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
  const userDataDir = mkdtempSync(join(tmpdir(), 'fh-ext-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: execPath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--headless=new',
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
    ],
  });
  try {
    // wait for the service worker to register
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    console.error('service worker:', sw.url());

    const page = await ctx.newPage();
    await page.goto(FIXTURE, { waitUntil: 'networkidle' });

    const downloadP = page.waitForEvent('download', { timeout: 15000 });
    const newTabP = ctx.waitForEvent('page', { timeout: 15000 });

    // trigger a full-page capture the way the popup does: inject content.js on
    // demand, then message it
    await sw.evaluate(async () => {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (t?.id == null) return;
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(t.id, { type: 'fh:capture', output: 'both', fontMode: 'embed' });
    });

    const download = await downloadP;
    console.error('download:', download.suggestedFilename());
    const preview = await newTabP;
    await preview.waitForLoadState('domcontentloaded');
    const hasSvg = await preview.evaluate(() => !!document.querySelector('#stage svg'));
    console.error('preview url:', preview.url(), 'has svg:', hasSvg);

    if (!download.suggestedFilename().endsWith('.svg') || !hasSvg) {
      throw new Error('extension flow did not produce expected outputs');
    }
    console.error('EXTENSION E2E OK');
  } finally {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error('EXTENSION E2E FAILED:', e.message);
  process.exit(1);
});
