/**
 * Content script: builds the SVG in-page (full tab or a picked element), delegating
 * raster fallback to the service worker. Injected on demand by the popup/background
 * (so it works on already-open tabs); guarded against double-injection. Output is
 * downloaded and/or opened in a preview tab per the chosen mode.
 */
import { captureCurrentPage, captureElement } from '../browser/index.js';
import { createTiledRasterizer } from '../browser/tiled-raster.js';
import { createViewportRasterizer } from '../browser/viewport-raster.js';

type OutputMode = 'both' | 'download' | 'preview';
type FontMode = 'embed' | 'outline' | 'none';
type Scope = 'viewport' | 'full';

interface BitmapShot {
  scale: number;
  bitmap: ImageBitmap;
}

/** Ask the service worker for a screenshot of the *current* viewport. */
function shootViewport(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'fh:shoot' }, (resp) => resolve(resp?.dataUrl ?? null));
  });
}

/** Decode a service-worker viewport screenshot into a CSS-px-scaled ImageBitmap. */
async function shootBitmap(): Promise<BitmapShot | null> {
  const url = await shootViewport();
  if (!url) return null;
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  return { scale: bitmap.width / Math.max(1, window.innerWidth), bitmap };
}

/** Encode an OffscreenCanvas as a PNG data URL (null on failure). */
async function canvasToDataUrl(canvas: OffscreenCanvas): Promise<string | null> {
  try {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** OffscreenCanvas-backed TileCanvas adapter shared by both rasterizers. */
function makeCanvas(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return {
    draw: (shot: BitmapShot, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) =>
      ctx.drawImage(shot.bitmap, sx, sy, sw, sh, dx, dy, dw, dh),
    toDataURL: () => canvasToDataUrl(canvas),
  };
}

/**
 * Full-page rasterizer (fresh screenshot cache per capture): resolves
 * document-coordinate regions by scrolling them through the viewport,
 * screenshotting via the service worker, and compositing with OffscreenCanvas.
 * All tiling/sequencing lives in the shared createTiledRasterizer; this is just
 * the browser-environment adapter.
 */
function makeRasterizer() {
  return createTiledRasterizer<BitmapShot>({
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    getMaxScroll: () => ({
      x: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      y: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    }),
    getScroll: () => ({ x: window.scrollX, y: window.scrollY }),
    scrollTo: (x, y) => window.scrollTo(x, y),
    // Wait for layout + paint to settle after a programmatic scroll.
    settle: () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    shoot: shootBitmap,
    createCanvas: makeCanvas,
  });
}

/**
 * Viewport-only rasterizer: one screenshot, crop each (viewport-relative) region
 * out of it, no scrolling. All cropping/clamping lives in the shared
 * createViewportRasterizer; this is just the browser-environment adapter.
 */
function makeViewportRasterizer() {
  return createViewportRasterizer<BitmapShot>({
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    shoot: shootBitmap,
    createCanvas: makeCanvas,
  });
}

function safeName(base: string): string {
  return (base || 'page').replace(/[^\w.-]+/g, '_').slice(0, 60) + '.svg';
}

function output(svg: string, name: string, mode: OutputMode) {
  if (mode !== 'preview') {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  if (mode !== 'download') {
    chrome.runtime.sendMessage({ type: 'fh:preview', svg, name });
  }
}

async function capturePage(fontMode: FontMode, mode: OutputMode, scope: Scope) {
  const svg =
    scope === 'full'
      ? await captureCurrentPage({ fontMode, rasterize: makeRasterizer() })
      : await captureCurrentPage({ fontMode, viewportOnly: true, rasterize: makeViewportRasterizer() });
  output(svg, safeName(document.title), mode);
  return svg.length;
}

// ── element picker ───────────────────────────────────────────────────────────

let pickerActive = false;

function startPicker(fontMode: FontMode, mode: OutputMode) {
  if (pickerActive) return;
  pickerActive = true;

  const overlay = document.createElement('div');
  overlay.setAttribute('data-fh-overlay', '');
  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    background: 'rgba(22,119,255,0.25)',
    border: '1px solid rgba(22,119,255,0.9)',
    boxSizing: 'border-box',
    top: '0',
    left: '0',
    width: '0',
    height: '0',
    transition: 'none',
  } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('div');
  label.setAttribute('data-fh-overlay', '');
  Object.assign(label.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    font: '12px/1.4 monospace',
    color: '#fff',
    background: 'rgba(22,119,255,0.95)',
    padding: '2px 6px',
    borderRadius: '3px',
    top: '0',
    left: '0',
    whiteSpace: 'nowrap',
  } as Partial<CSSStyleDeclaration>);

  document.documentElement.append(overlay, label);
  let current: Element | null = null;

  const onMove = (e: MouseEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.hasAttribute('data-fh-overlay')) return;
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      top: r.top + 'px',
      left: r.left + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
    });
    const tag = el.tagName.toLowerCase();
    const cls = el.classList[0] ? '.' + el.classList[0] : '';
    label.textContent = `${tag}${cls}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    label.style.top = Math.max(0, r.top - 22) + 'px';
    label.style.left = r.left + 'px';
  };

  const cleanup = () => {
    pickerActive = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    label.remove();
  };

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const chosen = current;
    cleanup();
    if (chosen) {
      captureElement(chosen, { fontMode, rasterize: makeRasterizer() })
        .then((svg) => output(svg, safeName((chosen as HTMLElement).id || chosen.tagName.toLowerCase()), mode))
        .catch((err) => console.error('[fitting-html]', err));
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    }
  };

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}

// Guard so on-demand re-injection doesn't register duplicate listeners.
if (!(window as any).__fhInstalled) {
  (window as any).__fhInstalled = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const mode: OutputMode = msg?.output ?? 'both';
    const fontMode: FontMode = msg?.fontMode ?? 'embed';
    const scope: Scope = msg?.scope === 'full' ? 'full' : 'viewport';
    if (msg?.type === 'fh:capture') {
      capturePage(fontMode, mode, scope)
        .then((bytes) => sendResponse({ ok: true, bytes }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true; // async response
    }
    if (msg?.type === 'fh:pick') {
      startPicker(fontMode, mode);
      sendResponse({ ok: true });
    }
  });
}
