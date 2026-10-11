import type { Page } from 'playwright';

const FETCH_TIMEOUT_MS = 15_000;

/** Encode PNG bytes as a data URI. */
export const pngDataUrl = (buf: Buffer): string => 'data:image/png;base64,' + buf.toString('base64');

/** Resolve once the page's web fonts have loaded. */
export const waitForFonts = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready;
  });

/**
 * GET a URL through the browser context's request API (shares cookies, bypasses CORS) with the page as
 * referer. Returns null on any network failure so callers can fall back to a screenshot / by-name font.
 */
export async function fetchViaContext(page: Page, url: string) {
  try {
    return await page.context().request.get(url, { headers: { referer: page.url() }, timeout: FETCH_TIMEOUT_MS });
  } catch {
    return null;
  }
}
