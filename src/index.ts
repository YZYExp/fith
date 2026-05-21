/**
 * Public API. Default entry = core pipeline + Node (Playwright) backend.
 */
export type * from './core/ir/types.js';
export { emitSvg } from './core/emit/svg.js';
export { captureScene } from './core/capture/capture.js';
export { renderToSvg } from './backends/node/playwright.js';
export type { RenderInput, RenderOptions } from './backends/node/playwright.js';

import { renderToSvg, type RenderInput, type RenderOptions } from './backends/node/playwright.js';

export interface ConvertOptions extends RenderOptions {}

/** Convert HTML / a URL into a self-contained SVG string. */
export async function htmlToSvg(
  input: string | RenderInput,
  options: ConvertOptions,
): Promise<string> {
  const normalized: RenderInput = typeof input === 'string' ? { html: input } : input;
  return renderToSvg(normalized, options);
}
