/**
 * Real-world benchmark corpus. Two kinds of targets:
 *  - live:  well-known public sites (need network; skipped when unreachable)
 *  - local: real third-party UI libraries pulled from the npm registry by
 *           `pnpm bench:fetch` and assembled into pages by bench/pages/*.html
 *
 * `maxRatio` is the regression gate (pixel-diff fraction); `minTextCoverage` is the
 * floor for vector-text chars / DOM-text chars; `maxRasterArea` is the fraction of the
 * viewport allowed to fall back to raster. Tighten these as fidelity improves.
 */
export interface Target {
  id: string;
  kind: 'live' | 'local';
  /** URL for live targets; path relative to bench/pages for local ones. */
  src: string;
  width: number;
  height: number;
  settleMs?: number;
  maxRatio: number;
  minTextCoverage?: number;
  maxRasterArea?: number;
  notes?: string;
}

// Live sites are only usable when every asset host is reachable: www.anthropic.com is excluded
// because its stylesheet CDN is blocked in the sandbox (renders unstyled, nothing to compare).
export const CORPUS: Target[] = [
  { id: 'live-nodejs', kind: 'live', src: 'https://nodejs.org/en', width: 1280, height: 1600, settleMs: 1500, maxRatio: 0.15 },
  { id: 'live-wikipedia', kind: 'live', src: 'https://en.wikipedia.org/wiki/Web_browser', width: 1280, height: 1800, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-hackernews', kind: 'live', src: 'https://news.ycombinator.com', width: 1280, height: 1200, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-mdn', kind: 'live', src: 'https://developer.mozilla.org/en-US/docs/Web/CSS/grid', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-reactdev', kind: 'live', src: 'https://react.dev', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-bbc', kind: 'live', src: 'https://www.bbc.com', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-apple', kind: 'live', src: 'https://www.apple.com', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-tailwindcss', kind: 'live', src: 'https://tailwindcss.com', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-stripe', kind: 'live', src: 'https://stripe.com', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-vercel', kind: 'live', src: 'https://vercel.com', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-pydocs', kind: 'live', src: 'https://docs.python.org/3/library/asyncio.html', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-bootstrap', kind: 'live', src: 'https://getbootstrap.com', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-antdesign', kind: 'live', src: 'https://ant.design', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-mui', kind: 'live', src: 'https://mui.com', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-vuejs', kind: 'live', src: 'https://vuejs.org', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-guardian', kind: 'live', src: 'https://www.theguardian.com/international', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-reddit', kind: 'live', src: 'https://www.reddit.com', width: 1280, height: 1400, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-amazon', kind: 'live', src: 'https://www.amazon.com', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.3 },
  { id: 'live-pypi', kind: 'live', src: 'https://pypi.org', width: 1280, height: 1400, settleMs: 1000, maxRatio: 0.15 },
  { id: 'lib-bootstrap-dashboard', kind: 'local', src: 'bootstrap-dashboard.html', width: 1280, height: 1000, settleMs: 1500, maxRatio: 0.02 },
  { id: 'lib-tailwind-landing', kind: 'local', src: 'tailwind-landing.html', width: 1280, height: 1100, settleMs: 1500, maxRatio: 0.03 },
  { id: 'lib-bulma-landing', kind: 'local', src: 'bulma-landing.html', width: 1280, height: 800, settleMs: 1500, maxRatio: 0.03 },
  { id: 'lib-daisyui-components', kind: 'local', src: 'daisyui-components.html', width: 1280, height: 1300, settleMs: 1500, maxRatio: 0.04 },
  { id: 'lib-github-readme', kind: 'local', src: 'github-readme.html', width: 1100, height: 1500, settleMs: 1500, maxRatio: 0.02 },
  { id: 'lib-swagger-ui', kind: 'local', src: 'swagger-ui.html', width: 1280, height: 1400, settleMs: 1500, maxRatio: 0.03 },
  { id: 'lib-katex-math', kind: 'local', src: 'katex-math.html', width: 900, height: 800, settleMs: 1500, maxRatio: 0.02 },
  { id: 'lib-mermaid-diagrams', kind: 'local', src: 'mermaid-diagrams.html', width: 1000, height: 1500, settleMs: 1500, maxRatio: 0.05 },
  { id: 'lib-echarts-dashboard', kind: 'local', src: 'echarts-dashboard.html', width: 1280, height: 1000, settleMs: 1500, maxRatio: 0.05 },
  { id: 'lib-chartjs-canvas', kind: 'local', src: 'chartjs-canvas.html', width: 1280, height: 900, settleMs: 1500, maxRatio: 0.05 },
  { id: 'lib-ag-grid', kind: 'local', src: 'ag-grid.html', width: 1280, height: 800, settleMs: 1500, maxRatio: 0.03 },
  { id: 'lib-fullcalendar', kind: 'local', src: 'fullcalendar.html', width: 1280, height: 900, settleMs: 1500, maxRatio: 0.03 },
  { id: 'lib-leaflet-map', kind: 'local', src: 'leaflet-map.html', width: 1000, height: 640, settleMs: 1500, maxRatio: 0.08 },
  { id: 'lib-reveal-slides', kind: 'local', src: 'reveal-slides.html', width: 1280, height: 720, settleMs: 1500, maxRatio: 0.05 },
  { id: 'lib-quill-editor', kind: 'local', src: 'quill-editor.html', width: 900, height: 600, settleMs: 1500, maxRatio: 0.03 },
  { id: 'lib-antd-showcase', kind: 'local', src: 'antd-showcase.html', width: 1280, height: 1300, settleMs: 1500, maxRatio: 0.03 },
];
