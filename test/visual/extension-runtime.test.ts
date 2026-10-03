/** Exercise the built extension scripts with Chrome API shims in real DOMs.
 * The content shim deliberately exposes no chrome.permissions (as in Chrome).
 * Real extension loading and permission prompts remain covered by gated E2E.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import sparticuz from '@sparticuz/chromium';
import { buildExtension } from '../../scripts/build-extension.js';

let browser: Browser;
let context: BrowserContext;
let outdir: string;
const read = (file: string) => readFileSync(join(outdir, file), 'utf8');

beforeAll(async () => {
  outdir = await buildExtension(mkdtempSync(join(tmpdir(), 'fh-runtime-')));
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || await sparticuz.executablePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process'],
  });
  // Single-process Chromium cannot survive closing/reopening browser contexts.
  context = await browser.newContext({ viewport: { width: 400, height: 300 }, acceptDownloads: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  if (outdir) rmSync(outdir, { recursive: true, force: true });
});

async function contentPage(regionAvailable = true) {
  const page = await context.newPage();
  await page.setContent(readFileSync(resolve(__dirname, '../fixtures/extension-runtime.html'), 'utf8'));
  await page.evaluate((available) => {
    const g = globalThis as any;
    g.messages = [];
    g.exports = [];
    g.chrome = { runtime: {
      onMessage: { addListener: (listener: any) => { g.captureListener = listener; } },
      sendMessage: (msg: any, callback?: any) => {
        g.messages.push(msg.type);
        if (msg.type === 'fh:preview') {
          g.exports.push(msg.svg);
          if (g.holdPreview) return new Promise((resolve) => { g.finishPreview = resolve; });
          return Promise.resolve(g.failPreview ? { ok: false, error: 'Storage quota exceeded' } : { ok: true });
        }
        if (msg.type === 'fh:shootRegion' && !available) { callback({ dataUrl: null }); return; }
        const canvas = document.createElement('canvas');
        canvas.width = msg.type === 'fh:shootRegion' ? msg.rect.width : innerWidth;
        canvas.height = msg.type === 'fh:shootRegion' ? msg.rect.height : innerHeight;
        callback({ dataUrl: canvas.toDataURL() });
      },
    } };
    g.capture = (scope = 'full') => new Promise((resolve) => {
      g.captureListener({ type: 'fh:capture', output: 'preview', fontMode: 'none', scope }, {}, resolve);
    });
  }, regionAvailable);
  await page.addScriptTag({ content: read('content.js') });
  return page;
}

async function capture(page: Page, scope = 'full'): Promise<any> {
  return page.evaluate((scope) => (globalThis as any).capture(scope), scope);
}

describe('built extension content script', () => {
  it('captures full-page vectors and below-fold rasters without content permissions APIs', async () => {
    const page = await contentPage();
    try {
      const response = await capture(page);
      const result = await page.evaluate(() => ({ svg: (globalThis as any).exports[0], messages: (globalThis as any).messages }));
      expect(response.ok).toBe(true);
      expect(result.svg).toContain('Below the fold');
      expect(result.svg.match(/<image\b/g)).toHaveLength(2);
      expect(result.messages.filter((type: string) => type === 'fh:shootRegion')).toHaveLength(1);
      expect(response.bytes).toBe(Buffer.byteLength(result.svg));
    } finally { await page.close(); }
  });

  it('falls back to one viewport screenshot when debugger permission is unavailable', async () => {
    const page = await contentPage(false);
    try {
      expect((await capture(page)).ok).toBe(true);
      const result = await page.evaluate(() => ({ svg: (globalThis as any).exports[0], messages: (globalThis as any).messages }));
      expect(result.svg).toContain('Below the fold');
      expect(result.svg.match(/<image\b/g)).toHaveLength(1);
      expect(result.messages.filter((type: string) => type === 'fh:shoot')).toHaveLength(1);
    } finally { await page.close(); }
  });

  it('reports preview failures and releases the capture lock for retry', async () => {
    const page = await contentPage();
    try {
      await page.evaluate(() => { (globalThis as any).failPreview = true; });
      expect(await capture(page)).toMatchObject({ ok: false, error: expect.stringContaining('Storage quota') });
      await page.evaluate(() => { (globalThis as any).failPreview = false; });
      expect((await capture(page)).ok).toBe(true);
    } finally { await page.close(); }
  });

  it('rejects overlapping captures and element picks while awaiting output', async () => {
    const page = await contentPage();
    try {
      await page.evaluate(() => {
        const g = globalThis as any;
        g.holdPreview = true;
        g.firstCapture = g.capture();
      });
      await page.waitForFunction(() => !!(globalThis as any).finishPreview);
      expect(await capture(page)).toMatchObject({ ok: false, error: expect.stringContaining('already in progress') });
      const pick = await page.evaluate(() => new Promise((resolve) => {
        (globalThis as any).captureListener({ type: 'fh:pick' }, {}, resolve);
      }));
      expect(pick).toMatchObject({ ok: false });
      await page.evaluate(() => { (globalThis as any).finishPreview({ ok: true }); });
      expect(await page.evaluate(() => (globalThis as any).firstCapture)).toMatchObject({ ok: true });
    } finally { await page.close(); }
  });
});

describe('built extension viewer', () => {
  it('isolates captured markup in an image and downloads the original SVG bytes', async () => {
    const page = await context.newPage();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/><script>parent.injected = true</script><foreignObject width="50" height="50"><div xmlns="http://www.w3.org/1999/xhtml" id="untrusted">中文</div></foreignObject></svg>';
    try {
      await page.setContent(read('viewer.html').replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''));
      await page.evaluate((svg) => {
        const g = globalThis as any;
        g.URLSearchParams = class { get() { return 'preview-id'; } };
        g.chrome = { storage: { session: {
          get: async () => ({ 'preview-id': { svg, name: 'test.svg' } }),
          remove: async (id: string) => { g.removed = id; },
        } } };
      }, svg);
      await page.addScriptTag({ type: 'module', content: read('viewer.js') });
      await page.waitForFunction(() => !(document.getElementById('download') as HTMLButtonElement).disabled);
      expect(await page.locator('#stage img').count()).toBe(1);
      expect(await page.locator('#untrusted, #stage svg, #stage script').count()).toBe(0);
      expect(await page.evaluate(() => (globalThis as any).injected)).toBeUndefined();
      expect(await page.evaluate(() => (globalThis as any).removed)).toBe('preview-id');
      const downloadPromise = page.waitForEvent('download');
      await page.click('#download');
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('test.svg');
      const stream = await download.createReadStream();
      let actual = '';
      for await (const chunk of stream!) actual += chunk;
      expect(actual).toBe(svg);
    } finally { await page.close(); }
  });

  it('shows storage failures with download disabled', async () => {
    const page = await context.newPage();
    try {
      await page.setContent(read('viewer.html').replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''));
      await page.evaluate(() => {
        const g = globalThis as any;
        g.URLSearchParams = class { get() { return 'preview-id'; } };
        g.chrome = { storage: { session: { get: async () => { throw new Error('Storage unavailable'); } } } };
      });
      await page.addScriptTag({ type: 'module', content: read('viewer.js') });
      await page.waitForFunction(() => document.getElementById('empty')?.textContent?.includes('Storage unavailable'));
      expect(await page.locator('#download').isDisabled()).toBe(true);
    } finally { await page.close(); }
  });
});

async function popupPage(saved: Record<string, string> = {}) {
  const page = await context.newPage();
  await page.setContent(read('popup.html').replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''));
  await page.evaluate((saved) => {
    const g = globalThis as any;
    g.calls = [];
    g.chrome = {
      storage: { local: {
        get: async () => saved,
        set: async () => {
          g.calls.push('save');
          if (g.failSave) throw new Error('Storage unavailable');
        },
      } },
      permissions: { request: async () => { g.calls.push('permission'); return false; } },
      tabs: {
        query: async () => [{ id: 1, url: 'https://example.com' }],
        sendMessage: async () => {
          g.calls.push('capture');
          return new Promise((resolve) => { g.finishCapture = resolve; });
        },
      },
      scripting: { executeScript: async () => { g.calls.push('inject'); } },
    };
  }, saved);
  await page.addScriptTag({ type: 'module', content: read('popup.js') });
  await page.waitForFunction(() => !(document.getElementById('page') as HTMLButtonElement).disabled);
  return page;
}

describe('built extension popup', () => {
  it('recovers invalid preferences and blocks duplicate clicks while capture runs', async () => {
    const page = await popupPage({ fhScope: 'invalid', fhFont: 'invalid', fhOutput: 'invalid' });
    try {
      expect(await page.locator('#scope').inputValue()).toBe('viewport');
      expect(await page.locator('#font').inputValue()).toBe('embed');
      expect(await page.locator('#output').inputValue()).toBe('both');
      await page.selectOption('#scope', 'full');
      await page.click('#page');
      await page.waitForFunction(() => !!(globalThis as any).finishCapture);
      expect(await page.locator('#pick').isDisabled()).toBe(true);
      expect(await page.locator('#scope').isDisabled()).toBe(true);
      await page.evaluate(() => document.getElementById('page')!.dispatchEvent(new MouseEvent('click')));
      expect(await page.evaluate(() => (globalThis as any).calls.filter((call: string) => call === 'capture').length)).toBe(1);
      // Optional permission denial still reaches capture, requested before injection.
      expect(await page.evaluate(() => (globalThis as any).calls.indexOf('permission') < (globalThis as any).calls.indexOf('inject'))).toBe(true);
      await page.evaluate(() => (globalThis as any).finishCapture({ ok: true, bytes: 2048 }));
      await page.waitForFunction(() => document.getElementById('status')?.textContent === 'Done (2 KB)');
      expect(await page.locator('#page').isEnabled()).toBe(true);
    } finally { await page.close(); }
  });

  it('reports preference write failures and allows a successful retry', async () => {
    const page = await popupPage();
    try {
      await page.evaluate(() => { (globalThis as any).failSave = true; });
      await page.click('#page');
      await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('Storage unavailable'));
      expect(await page.locator('#page').isEnabled()).toBe(true);
      await page.evaluate(() => { (globalThis as any).failSave = false; });
      await page.click('#page');
      await page.waitForFunction(() => !!(globalThis as any).finishCapture);
      await page.evaluate(() => (globalThis as any).finishCapture({ ok: true }));
      await page.waitForFunction(() => document.getElementById('status')?.textContent === 'Done');
    } finally { await page.close(); }
  });
});

describe('built extension preview handoff', () => {
  it.each(['success', 'storage failure', 'tab failure'])('responds on %s and cleans up failed handoffs', async (scenario) => {
    let listener: any;
    const remove = vi.fn(async () => {});
    const create = vi.fn(async () => {
      if (scenario === 'tab failure') throw new Error('Cannot open tab');
    });
    runInNewContext(read('background.js'), {
      console, setTimeout, clearTimeout,
      chrome: {
        runtime: {
          onInstalled: { addListener: () => {} },
          onMessage: { addListener: (fn: any) => { listener = fn; } },
          getURL: (path: string) => 'chrome-extension://test/' + path,
        },
        contextMenus: { onClicked: { addListener: () => {} } },
        commands: { onCommand: { addListener: () => {} } },
        tabs: { create },
        storage: { session: {
          set: async () => { if (scenario === 'storage failure') throw new Error('Quota exceeded'); },
          remove,
        } },
      },
    });
    const response: any = await new Promise((resolve) => {
      expect(listener({ type: 'fh:preview', svg: '<svg/>', name: 'test.svg' }, {}, resolve)).toBe(true);
    });
    expect(response.ok).toBe(scenario === 'success');
    if (scenario === 'success') {
      expect(remove).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledOnce();
    } else {
      expect(response.error).toMatch(/Quota exceeded|Cannot open tab/);
      expect(remove).toHaveBeenCalledOnce();
      if (scenario === 'storage failure') expect(create).not.toHaveBeenCalled();
    }
  });
});
