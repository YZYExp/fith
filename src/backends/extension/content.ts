/**
 * Content script: builds the SVG in-page (full tab or a picked element), delegating
 * raster fallback to the service worker. Injected on demand by the popup/background
 * (so it works on already-open tabs); guarded against double-injection. Output is
 * downloaded and/or opened in a preview tab per the chosen mode.
 */
import { captureCurrentPage, captureElement } from '../browser/index.js';
import { planRegionTiles } from '../browser/tiles.js';
import type { Rect } from '../../core/ir/types.js';

type OutputMode = 'both' | 'download' | 'preview';
type FontMode = 'embed' | 'outline' | 'none';

/** Ask the service worker for a screenshot of the *current* viewport. */
function shootViewport(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'fh:shoot' }, (resp) => resolve(resp?.dataUrl ?? null));
  });
}

/** Wait for layout + paint to settle after a programmatic scroll. */
const settle = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * Build a rasterizer that captures document-coordinate regions correctly even
 * when they are off-screen or larger than the viewport: it scrolls each region
 * through the viewport tile-by-tile, screenshots every slice (deduplicated by
 * scroll position), and composites them. A fresh cache is created per capture
 * so screenshots aren't reused across unrelated runs.
 */
function makeRasterizer() {
  // Decoded viewport screenshots, keyed by the scroll position they were taken
  // at — adjacent raster regions sharing a viewport reuse a single screenshot,
  // which also keeps us under captureVisibleTab's rate limit.
  const shotCache = new Map<string, Promise<{ bitmap: ImageBitmap; scale: number } | null>>();

  const shotAt = (scrollX: number, scrollY: number) => {
    const key = Math.round(scrollX) + ',' + Math.round(scrollY);
    let p = shotCache.get(key);
    if (!p) {
      p = (async () => {
        const url = await shootViewport();
        if (!url) return null;
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        // Device px per CSS px (covers devicePixelRatio + browser zoom).
        const scale = bitmap.width / Math.max(1, window.innerWidth);
        return { bitmap, scale };
      })();
      shotCache.set(key, p);
    }
    return p;
  };

  const rasterize = async (rect: Rect): Promise<string | null> => {
    const saveX = window.scrollX;
    const saveY = window.scrollY;
    try {
      const vp = { width: window.innerWidth, height: window.innerHeight };
      const maxScroll = {
        x: Math.max(0, document.documentElement.scrollWidth - vp.width),
        y: Math.max(0, document.documentElement.scrollHeight - vp.height),
      };
      const tiles = planRegionTiles(rect, vp, maxScroll);
      if (tiles.length === 0) return null;

      let canvas: OffscreenCanvas | null = null;
      let ctx: OffscreenCanvasRenderingContext2D | null = null;
      let scale = 0;

      for (const t of tiles) {
        window.scrollTo(t.scrollX, t.scrollY);
        await settle();
        const shot = await shotAt(window.scrollX, window.scrollY);
        if (!shot) continue;
        if (!canvas) {
          scale = shot.scale;
          canvas = new OffscreenCanvas(
            Math.max(1, Math.round(rect.width * scale)),
            Math.max(1, Math.round(rect.height * scale)),
          );
          ctx = canvas.getContext('2d');
          if (!ctx) return null;
        }
        ctx!.drawImage(
          shot.bitmap,
          t.srcX * scale, t.srcY * scale, t.width * scale, t.height * scale,
          t.dstX * scale, t.dstY * scale, t.width * scale, t.height * scale,
        );
      }
      if (!canvas) return null;
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return await new Promise<string | null>((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(blob);
      });
    } catch {
      return null;
    } finally {
      window.scrollTo(saveX, saveY);
    }
  };

  return rasterize;
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

async function capturePage(fontMode: FontMode, mode: OutputMode) {
  const svg = await captureCurrentPage({ fontMode, rasterize: makeRasterizer() });
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
    if (msg?.type === 'fh:capture') {
      capturePage(fontMode, mode)
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
