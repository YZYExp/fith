/**
 * Public API, environment-free: the scene IR, the SVG emitter and the report. It imports neither Playwright
 * nor opentype.js. Capturing runs in a page (`fitting-html/browser`) or through Playwright
 * (`fitting-html/node`); glyph outlines come from `fitting-html/outline`.
 */
export type * from './core/ir/types.js';
export { emitSvg } from './core/emit/svg.js';
export type { EmitOptions } from './core/emit/svg.js';
export { buildReport } from './core/report.js';
