import type { Page } from 'playwright';
import type { CaptureOptions, Scene } from '../../core/ir/types.js';

let source: Promise<string> | undefined;

/**
 * The in-page bundle: the pre-built `bundle.generated.ts` in a package build, bundled on the fly by
 * esbuild when running from source (tsx / vitest) without having run `pnpm build:inject`.
 */
function bundleSource(): Promise<string> {
  source ??= (async () => {
    const generated = '../../inject/bundle.generated.js';
    try {
      return ((await import(generated)) as { default: string }).default;
    } catch {
      const { injectSource } = await import(/* @vite-ignore */ '../../../scripts/build-inject.js' as string);
      return (injectSource as () => Promise<string>)();
    }
  })();
  return source;
}

interface InPage {
  captureScene(opts: CaptureOptions): Promise<Scene>;
  captureSourceHtml(root?: Element | null): string;
}

/** Make sure the capture bundle is loaded in the page (once per document). */
async function ensureInjected(page: Page): Promise<void> {
  if (await page.evaluate(() => '__fith' in globalThis)) return;
  // evaluated as an expression, not added as a <script>: a page's CSP cannot block it
  await page.evaluate(`${await bundleSource()}\n;undefined`);
}

export async function runCaptureScene(page: Page, opts: CaptureOptions): Promise<Scene> {
  await ensureInjected(page);
  return page.evaluate((o) => (globalThis as unknown as { __fith: InPage }).__fith.captureScene(o), opts);
}

export async function runCaptureSourceHtml(page: Page): Promise<string> {
  await ensureInjected(page);
  return page.evaluate(() => (globalThis as unknown as { __fith: InPage }).__fith.captureSourceHtml());
}
