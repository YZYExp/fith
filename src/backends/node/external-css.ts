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
  for (const href of hrefs.slice(0, 16)) {
    try {
      const res = await page.context().request.get(href, { headers: { referer: page.url() }, timeout: 15_000 });
      if (res.ok()) map[href] = await res.text();
    } catch {
      /* unreachable: fonts in this sheet stay referenced by name */
    }
  }
  return map;
}
