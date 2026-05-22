/**
 * Content script: builds the SVG in-page (full tab or a picked element), delegating
 * raster fallback to the service worker. Output is downloaded and opened in a
 * preview tab. A DevTools-style hover picker selects an element to convert.
 */
import { captureCurrentPage, captureElement } from '../browser/index.js';
import type { Rect } from '../../core/ir/types.js';

function rasterize(rect: Rect): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'fh:rasterize', rect, dpr: window.devicePixelRatio || 1 },
      (resp) => resolve(resp?.dataUrl ?? null),
    );
  });
}

function safeName(base: string): string {
  return (base || 'page').replace(/[^\w.-]+/g, '_').slice(0, 60) + '.svg';
}

function output(svg: string, name: string) {
  // 1) download
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  // 2) preview tab (handed to the service worker)
  chrome.runtime.sendMessage({ type: 'fh:preview', svg, name });
}

async function capturePage(fontMode: 'embed' | 'outline' | 'none') {
  const svg = await captureCurrentPage({ fontMode, rasterize });
  output(svg, safeName(document.title));
  return svg.length;
}

// ── element picker ───────────────────────────────────────────────────────────

let pickerActive = false;

function startPicker() {
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
      captureElement(chosen, { fontMode: 'embed', rasterize })
        .then((svg) => output(svg, safeName((chosen as HTMLElement).id || chosen.tagName.toLowerCase())))
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'fh:capture') {
    capturePage(msg.fontMode ?? 'embed')
      .then((bytes) => sendResponse({ ok: true, bytes }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
  if (msg?.type === 'fh:pick') {
    startPicker();
    sendResponse({ ok: true });
  }
});
