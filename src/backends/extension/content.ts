/**
 * Content script: builds the SVG in-page (full tab or a picked element), delegating
 * raster fallback to the service worker. Injected on demand by the popup/background
 * (so it works on already-open tabs); guarded against double-injection. Output is
 * downloaded and/or opened in a preview tab per the chosen mode.
 */
import { captureCurrentPage, captureElement } from '../browser/index.js';
import { createViewportRasterizer } from '../browser/viewport-raster.js';
import { MAX_REGION_DEVICE_PX, type OutputMode, type FontMode, type Scope } from './messages.js';
import type { Rect } from '../../core/ir/types.js';

interface BitmapShot {
  scale: number;
  bitmap: ImageBitmap;
}

/**
 * Send a message to the service worker and resolve its `dataUrl`, but never hang:
 * if the worker is suspended mid-call or the callback is dropped, resolve null
 * after `timeoutMs` so the capture pipeline always completes (falling back to a
 * viewport crop, or omitting that one raster node).
 */
function requestDataUrl(msg: unknown, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        clearTimeout(timer);
        // Touch lastError so Chrome doesn't log "Unchecked runtime.lastError".
        void chrome.runtime.lastError;
        finish(resp?.dataUrl ?? null);
      });
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/** Ask the service worker for a screenshot of the *current* viewport. */
function shootViewport(): Promise<string | null> {
  return requestDataUrl({ type: 'fh:shoot' }, 8000);
}

/**
 * Ask the service worker for an exact-region screenshot via chrome.debugger
 * (Page.captureScreenshot + captureBeyondViewport): captures any document region
 * — including below the fold — in one shot, WITHOUT scrolling. Returns null when
 * the optional `debugger` permission isn't granted or the shot is too slow/large
 * (caller falls back to a viewport crop), so it never forces the permission and
 * never hangs.
 */
function shootRegion(rect: Rect, scale: number): Promise<string | null> {
  return requestDataUrl({ type: 'fh:shootRegion', rect, scale }, 15000);
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
 * Viewport-only rasterizer: coords are viewport-relative (origin {0,0}); crop
 * each region out of one current-viewport screenshot, no scrolling.
 */
function makeViewportRasterizer() {
  return createViewportRasterizer<BitmapShot>({
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    shoot: shootBitmap,
    createCanvas: makeCanvas,
  });
}

/** One full-document chrome.debugger screenshot, decoded once and cached. */
async function shootFullPageBitmap(): Promise<BitmapShot | null> {
  const docW = Math.max(document.documentElement.scrollWidth, document.documentElement.clientWidth, 1);
  const docH = Math.max(document.documentElement.scrollHeight, document.documentElement.clientHeight, 1);
  const dpr = window.devicePixelRatio || 1;
  if (docW * docH * dpr * dpr > MAX_REGION_DEVICE_PX) return null;
  const url = await shootRegion({ x: 0, y: 0, width: docW, height: docH }, dpr);
  if (!url) return null;
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  return { scale: bitmap.width / docW, bitmap };
}

/**
 * Full-page rasterizer (no scrolling). Coords are document-absolute, so the
 * viewport origin is the current scroll position. When the optional `debugger`
 * permission is granted, it takes ONE full-document screenshot (captureBeyond
 * viewport) and crops every region out of it client-side — reaching below the
 * fold with a single, bounded capture. If that's unavailable (permission denied,
 * page too large, timeout), it falls back to cropping the current viewport, so
 * off-screen raster is simply omitted. Either way it always completes.
 */
function makeFullPageRasterizer(useDebugger: boolean) {
  let full: Promise<BitmapShot | null> | null = null;
  const getFull = () => (full ??= shootFullPageBitmap());

  return createViewportRasterizer<BitmapShot>({
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    getOrigin: () => ({ x: window.scrollX, y: window.scrollY }),
    shootRegion: useDebugger
      ? async (rect) => {
          const f = await getFull();
          if (!f) return null; // → viewport-crop fallback
          const s = f.scale;
          const w = Math.max(1, Math.round(rect.width * s));
          const h = Math.max(1, Math.round(rect.height * s));
          const canvas = new OffscreenCanvas(w, h);
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          ctx.drawImage(f.bitmap, rect.x * s, rect.y * s, rect.width * s, rect.height * s, 0, 0, w, h);
          return canvasToDataUrl(canvas);
        }
      : undefined,
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
  let svg: string;
  if (scope === 'full') {
    // Use the exact-region debugger shot only if the permission is already
    // granted (the popup requests it on a user gesture); never block on it here.
    const useDebugger = await chrome.permissions
      .contains({ permissions: ['debugger'] })
      .catch(() => false);
    svg = await captureCurrentPage({ fontMode, rasterize: makeFullPageRasterizer(useDebugger) });
  } else {
    svg = await captureCurrentPage({ fontMode, viewportOnly: true, rasterize: makeViewportRasterizer() });
  }
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
      captureElement(chosen, { fontMode, rasterize: makeViewportRasterizer() })
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
