/**
 * End-to-end extension smoke test: load the *actual* built MV3 extension into a
 * real Chromium and exercise the full pipeline — content script ⇄ service
 * worker, real chrome.tabs.captureVisibleTab, SVG emit, and the download output
 * path — then assert the downloaded SVG is well-formed and contains the page's
 * text.
 *
 * Gated behind EXTENSION_E2E=1 because it needs a *full* Chromium that can load
 * extensions (the headless-shell used by the other visual tests cannot). Point
 * it at one via E2E_CHROME_PATH, or let it auto-detect a Playwright
 * "Chrome for Testing" install. Run:
 *   EXTENSION_E2E=1 npx vitest run test/visual/extension-e2e.test.ts
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Worker } from 'playwright';
import { buildExtension } from '../../scripts/build-extension.js';
import { serveDir } from '../../scripts/validate.js';

const RUN = process.env.EXTENSION_E2E === '1';

/** Locate a full Chromium that can load extensions (not the headless shell). */
function findFullChrome(): string | null {
  if (process.env.E2E_CHROME_PATH && existsSync(process.env.E2E_CHROME_PATH)) return process.env.E2E_CHROME_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', join(process.env.HOME || '', '.cache/ms-playwright')];
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    // Newest "chromium-<rev>" dir whose full (non-headless-shell) binary exists.
    const dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const bin = resolve(root, d, 'chrome-linux64/chrome');
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}

describe.runIf(RUN)('extension end-to-end (real Chromium)', () => {
  it(
    'converts the active tab to a downloadable SVG via the popup pipeline',
    async () => {
      const chrome = findFullChrome();
      expect(chrome, 'no full Chromium found; set E2E_CHROME_PATH').toBeTruthy();

      const ext = await buildExtension(mkdtempSync(join(tmpdir(), 'fh-e2e-')));
      const server = await serveDir(resolve(__dirname, '../fixtures'));
      const ctx = await chromium.launchPersistentContext('', {
        executablePath: chrome!,
        headless: true,
        args: [
          '--headless=new',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          `--disable-extensions-except=${ext}`,
          `--load-extension=${ext}`,
        ],
      });
      try {
        let [sw] = ctx.serviceWorkers();
        if (!sw) sw = (await ctx.waitForEvent('serviceworker', { timeout: 15_000 })) as Worker;

        const page = await ctx.newPage();
        await page.goto(server.url + 'smoke.html', { waitUntil: 'networkidle' });
        const tabId = await sw.evaluate(async (u: string) => {
          const tabs = await (globalThis as any).chrome.tabs.query({});
          return tabs.find((t: any) => t.url === u)?.id as number;
        }, page.url());
        expect(tabId).toBeTruthy();

        // Trigger the same flow the popup/background uses: inject the content
        // script, then ask it to capture the page with the download output.
        const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
        await sw.evaluate(async (id: number) => {
          const c = (globalThis as any).chrome;
          await c.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
          await c.tabs.sendMessage(id, { type: 'fh:capture', output: 'download', fontMode: 'none' });
        }, tabId);

        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/\.svg$/);
        const stream = await download.createReadStream();
        let svg = '';
        for await (const chunk of stream) svg += chunk;

        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg).toContain('</svg>');
        // smoke.html's visible text must survive into the exported SVG.
        expect(svg).toContain('Hello SVG');
      } finally {
        await ctx.close();
        await server.close();
      }
    },
    120_000,
  );
});
