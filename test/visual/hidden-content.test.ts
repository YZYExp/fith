import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sparticuz from '@sparticuz/chromium';
import { build } from 'esbuild';

const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process'];
const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/hidden-content.html')).href;

/**
 * Structural check: text that the browser does not show (hidden attribute, display:none, visibility,
 * opacity:0, sr-only clip, content-visibility:hidden, closed details/dialog, zero-height clip) must not
 * appear in the Scene, with or without `captureScrollableContent` (which resets content-visibility).
 */
describe('hidden content is not drawn', () => {
  for (const captureScrollableContent of [false, true]) {
    it(
      `captureScrollableContent=${captureScrollableContent}`,
      async () => {
        const out = await build({
          entryPoints: [resolve(__dirname, '../../src/backends/browser/index.ts')],
          bundle: true, format: 'iife', globalName: 'Fith', write: false, target: 'chrome110',
        });
        const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
        const browser = await chromium.launch({ executablePath: execPath, args: ARGS });
        try {
          const page = await (await browser.newContext({ viewport: { width: 700, height: 600 } })).newPage();
          await page.goto(FIXTURE, { waitUntil: 'networkidle' });
          await page.addScriptTag({ content: out.outputFiles[0].text });
          const texts: string[] = await page.evaluate(async (csc) => {
            // @ts-expect-error injected global
            const scene = await Fith.captureScene({
              width: document.documentElement.clientWidth,
              height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
              deviceScaleFactor: 1, fontMode: 'none', captureScrollableContent: csc, containerRasterFallback: false,
            });
            return (scene.nodes as any[]).filter((n) => n.kind === 'text').map((n) => n.lines.map((l: any) => l.text).join(' '));
          }, captureScrollableContent);
          const all = texts.join('\n');
          expect(all).toContain('SHOWN plain text');
          expect(all).toContain('SHOWN content-visibility auto');
          expect(all).toContain('SHOWN open details body');
          expect(all).toContain('SHOWN last');
          expect(all).not.toMatch(/HIDDEN/);
        } finally {
          await browser.close();
        }
      },
      90_000,
    );
  }
});
