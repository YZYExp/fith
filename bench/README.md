# fith real-world benchmark

Runs fith against complex real pages and reports, per target: whole-page pixel diff, diff over
*content* pixels only (not diluted by whitespace), worst 64px tile, vector-text coverage, raster
area, node count, SVG size and capture time. Compared against `bench/baseline.json`.

```bash
pnpm bench:fetch                 # npm → bench/.cache (pinned real UI libraries; ~460 MB, gitignored)
pnpm bench                       # live sites + local library pages
pnpm bench --local | --live      # subset
pnpm bench --only=lib-leaflet-map
pnpm bench --update-baseline     # accept current numbers
pnpm inspect <url|file> <x> <y>  # trace a diff hotspot to DOM element + scene node
```

Output: `bench/out/report.md|json` and per-target `*.svg / .expected.png / .actual.png / .diff.png`.

* **local** targets (`bench/pages/*.html`) assemble real third-party UI code from npm — Bootstrap, Tailwind,
  Bulma, daisyUI, antd, AG Grid, FullCalendar, Swagger UI, KaTeX, Mermaid, ECharts, Chart.js, Leaflet, Reveal.js,
  Quill, github-markdown+highlight.js — and are served over http (fetch of fonts/images from `file://` is blocked).
* **live** targets need network; a target that can't be reached is reported as `skip`.
* Workflow: run → open the worst target's `expected` vs `actual` → `pnpm inspect` the hotspot → fix in `src/` →
  add a fixture + test in `test/visual/realworld-regressions.test.ts` → `pnpm bench --update-baseline`.
