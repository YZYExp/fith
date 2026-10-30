/**
 * Node backend: render HTML, a URL or a Playwright page to SVG. Needs the optional peer `playwright`
 * (and `opentype.js` for `fontMode: 'outline'`).
 */
export { renderToSvg, renderDetailed } from './backends/node/playwright.js';
export type { RenderInput, RenderOptions, RenderResult } from './backends/node/playwright.js';

import { renderToSvg, type RenderInput, type RenderOptions } from './backends/node/playwright.js';

export interface ConvertOptions extends RenderOptions {}

/** Convert HTML / a URL into a self-contained SVG string. */
export async function htmlToSvg(input: string | RenderInput, options: ConvertOptions): Promise<string> {
  const normalized: RenderInput = typeof input === 'string' ? { html: input } : input;
  return renderToSvg(normalized, options);
}
