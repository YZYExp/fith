/**
 * Content script: runs the pure in-page core to build the SVG, delegating
 * raster fallback to the service worker (which can screenshot the tab).
 */
import { captureCurrentPage } from '../browser/index.js';
import type { Rect } from '../../core/ir/types.js';

function rasterize(rect: Rect, scale: number): Promise<string | null> {
  void scale;
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'fh:rasterize', rect, dpr: window.devicePixelRatio || 1 },
      (resp) => resolve(resp?.dataUrl ?? null),
    );
  });
}

function downloadSvg(svg: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (document.title || 'page').replace(/[^\w.-]+/g, '_') + '.svg';
  a.click();
  URL.revokeObjectURL(url);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'fh:capture') return;
  captureCurrentPage({ fontMode: msg.fontMode ?? 'embed', rasterize })
    .then((svg) => {
      downloadSvg(svg);
      sendResponse({ ok: true, bytes: svg.length });
    })
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async response
});
