/** Pixels of images and canvases as data URLs. Stateless; the DOM-dependent ones take the document they work in. */

export const normDataUrl = (u: string): string => {
  const m = u.match(/^data:([^,]*?),([\s\S]*)$/);
  if (!m || /;base64$/i.test(m[1])) return u;
  try {
    const raw = decodeURIComponent(m[2]);
    const mime = m[1].split(';')[0] || 'text/plain';
    return `data:${mime};base64,${btoa(unescape(encodeURIComponent(raw)))}`;
  } catch {
    return u;
  }
};

type Win = Window & typeof globalThis;

export const blobToDataURL = (blob: Blob, win?: Win): Promise<string | null> =>
  new Promise((resolve) => {
    const fr = new (win?.FileReader ?? FileReader)();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(blob);
  });

/** Fetch with the window of the element's document when given: a frame's origin, referrer and CSP, not the host page's. */
export const fetchDataURL = async (url: string, win?: Win): Promise<string | null> => {
  // Guard against fetching the current page when img.src is empty or blank.
  if (!url || url === 'about:blank') return null;
  if (url.startsWith('data:')) return url;
  try {
    const res = await (win?.fetch ?? fetch).call(win ?? globalThis, url, { cache: 'force-cache' });
    if (!res.ok) return null;
    return await blobToDataURL(await res.blob(), win);
  } catch {
    return null;
  }
};

// Try to extract image pixels via canvas (works for decoded same-origin images
// and CORS-enabled cross-origin images without a network round-trip).
// Data URL of a canvas bitmap, or null when it cannot be read (tainted) or looks blank — a WebGL canvas
// without preserveDrawingBuffer reads back transparent, which must NOT replace the real pixels.
export const canvasDataUrl = (doc: Document, cv: HTMLCanvasElement): string | null => {
  if (cv.width === 0 || cv.height === 0) return null;
  try {
    const probe = doc.createElement('canvas');
    const pw = Math.min(64, cv.width), ph = Math.min(64, cv.height);
    probe.width = pw; probe.height = ph;
    const pc = probe.getContext('2d');
    if (!pc) return null;
    pc.drawImage(cv, 0, 0, pw, ph);
    const d = pc.getImageData(0, 0, pw, ph).data;
    let any = false;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) { any = true; break; }
    if (!any) return null;
    return cv.toDataURL('image/png');
  } catch {
    return null;
  }
};

export const canvasExtractDataURL = (doc: Document, img: HTMLImageElement): string | null => {
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return null;
  try {
    const c = doc.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  } catch {
    return null; // cross-origin without CORS headers: canvas is tainted
  }
};
