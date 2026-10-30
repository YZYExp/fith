/**
 * Entry of the bundle the Node backend injects into the page. It is built by esbuild into one IIFE
 * (scripts/build-inject.ts), so the in-page code may import modules; it is no longer serialised with
 * `Function.prototype.toString`.
 */
import { captureScene } from '../core/capture/capture.js';
import { captureSourceHtml } from '../core/capture/source-html.js';

(globalThis as { __fith?: unknown }).__fith = { captureScene, captureSourceHtml };
