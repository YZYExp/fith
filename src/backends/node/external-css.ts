import type { Page } from 'playwright';

/**
 * Stylesheets served from another origin without CORS headers (CDNs) throw on `.cssRules`, so in-page
 * capture cannot see their @font-face rules. Node can read them through the browser context's request
 * API (no CORS) — return href → CSS text for captureScene's `externalCss` option.
 */
export async function collectExternalCss(page: Page): Promise<Record<string, string>> {
  const hrefs: string[] = await page.evaluate(() => {
    const out = new Set<string>();
    // function declaration (not a const arrow): immune to pages that define a global __name helper
    function visit(sheet: CSSStyleSheet, depth: number): void {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        if (sheet.href) out.add(sheet.href);
        return;
      }
      if (depth > 4) return;
      for (const r of Array.from(rules)) {
        const sub = (r as CSSImportRule).styleSheet;
        if (sub) visit(sub, depth + 1);
      }
    }
    for (const s of Array.from(document.styleSheets)) visit(s as CSSStyleSheet, 0);
    return Array.from(out);
  });
  const map: Record<string, string> = {};
  // sites like linear.app ship 50+ opaque sheets, @font-face can be in any of them: fetch them all, 8 at a time
  const list = hrefs.slice(0, 120);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const href = list[next++];
      try {
        const res = await page.context().request.get(href, { headers: { referer: page.url() }, timeout: 15_000 });
        if (res.ok()) {
          const text = await res.text();
          // sheets without @font-face/@import can't matter for fonts: record them empty so the page doesn't re-fetch
          map[href] = /@font-face|@import/.test(text) ? text : '';
        }
      } catch {
        /* unreachable: fonts in this sheet stay referenced by name */
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return map;
}
