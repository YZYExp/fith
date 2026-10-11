import type { Page } from 'playwright';
import type { Scene, ImageNode } from '../../core/ir/types.js';
import { fetchViaContext } from './page-utils.js';

/**
 * <img>s the page could not read in-page (cross-origin without CORS headers) are captured as raster
 * placeholders. In Node we can simply download the file with the browser context's cookies and embed
 * the real bytes: a true <image> (full resolution, object-fit via preserveAspectRatio) beats a
 * screenshot of whatever was painted over it. Falls back to the screenshot path on any failure.
 */
export async function resolveCorsImages(page: Page, scene: Scene, maxBytes = 6 * 1024 * 1024): Promise<number> {
  let resolved = 0;
  for (const node of scene.nodes) {
    if (node.kind !== 'raster' || node.reason !== 'img-cors' || !node.imgFallback) continue;
    const { src, rect, preserveAspectRatio } = node.imgFallback;
    if (!/^https?:/i.test(src)) continue;
    try {
      const res = await fetchViaContext(page, src);
      if (!res) continue;
      const type = (res.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!res.ok() || !/^image\//.test(type)) continue;
      const body = await res.body();
      if (body.length === 0 || body.length > maxBytes) continue;
      const img = node as unknown as ImageNode & { reason?: string; imgFallback?: unknown };
      Object.assign(img, { kind: 'image', rect, href: `data:${type};base64,${body.toString('base64')}`, preserveAspectRatio: preserveAspectRatio || 'none' });
      delete img.reason;
      delete img.imgFallback;
      resolved++;
    } catch {
      /* leave as raster → screenshot */
    }
  }
  return resolved;
}
