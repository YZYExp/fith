/**
 * Packaging integrity: build the MV3 extension and verify the produced bundle
 * is internally consistent — the manifest parses, every file it references
 * (service worker, popup, plus the scripts those HTML pages load) is present,
 * and the on-demand-injected content script is bundled. Catches the classic
 * "renamed/removed an entry point and the extension silently 404s" breakage.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { buildExtension } from '../scripts/build-extension.js';

let outdir: string;

beforeAll(async () => {
  outdir = await buildExtension(mkdtempSync(join(tmpdir(), 'fh-ext-')));
}, 60_000);

const read = (f: string) => readFileSync(join(outdir, f), 'utf8');
const has = (f: string) => existsSync(join(outdir, f));
/** All `src="..."`/`href="...js"` script references in an HTML file. */
const scriptsIn = (html: string) =>
  Array.from(html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)).map((m) => m[1]);

describe('extension bundle integrity', () => {
  it('produces a valid MV3 manifest', () => {
    const manifest = JSON.parse(read('manifest.json'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background?.service_worker).toBeTruthy();
    expect(manifest.action?.default_popup).toBeTruthy();
  });

  it('bundles every file the manifest references', () => {
    const manifest = JSON.parse(read('manifest.json'));
    expect(has(manifest.background.service_worker)).toBe(true); // background.js
    expect(has(manifest.action.default_popup)).toBe(true); // popup.html
  });

  it('bundles every script its HTML pages load', () => {
    for (const page of ['popup.html', 'viewer.html']) {
      expect(has(page)).toBe(true);
      for (const src of scriptsIn(read(page))) {
        expect(has(src), `${page} references missing ${src}`).toBe(true);
      }
    }
  });

  it('bundles the shared stylesheet referenced by both interfaces', () => {
    expect(has('ui.css')).toBe(true);
    for (const page of ['popup.html', 'viewer.html']) {
      expect(read(page)).toContain('href="ui.css"');
    }
  });

  it('bundles the on-demand-injected content script', () => {
    // background.ts / popup.ts inject 'content.js' via chrome.scripting.
    expect(has('content.js')).toBe(true);
    // It must be a classic IIFE (executeScript can't load ES modules).
    expect(read('content.js')).not.toMatch(/^\s*export\b/m);
  });
});
