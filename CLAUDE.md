# fitting-html — Development Guide

## Project Overview

`fitting-html` converts HTML pages or elements into self-contained SVG files.
It works in three environments:
- **Node/Playwright** (`src/backends/node/playwright.ts`) — full-page SVG via a headless Chromium
- **Browser in-page** (`src/backends/browser/index.ts`) — run directly inside a page (no server)
- **Chrome extension** (`src/backends/extension/`) — popup + content script + service worker

The core is a two-phase pipeline:
1. `captureScene` (runs in-page) — walks the DOM, emits a `Scene` IR of `PaintNode[]`
2. `emitSvg` (Node or in-page) — serializes the IR to an SVG string

## Key Architecture Constraints

- `captureScene` in `src/core/capture/capture.ts` must be **fully self-contained**:
  it is serialized via `.toString()` and injected into Chromium by `page.evaluate`.
  No imports, no closure references to module-level symbols — every helper must be
  defined inside the function body.

- The `Scene` IR is the boundary between the in-page capture and the Node backend.
  Fields added to `Scene` must be added to `src/core/ir/types.ts`.

- `pushRaster` coordinates are **viewport/page px** (from `getBoundingClientRect`),
  not subtree-relative. The SVG `viewBox` handles the origin offset for subtree exports.

## Commands

```bash
npm run build    # TypeScript compile (tsc)
npm test         # Vitest — all visual + unit tests
```

## Acceptance Criteria

**Every commit and PR must satisfy:**

1. **Build passes**: `npm run build` exits 0 with no TypeScript errors.
2. **Tests pass**: `npm test` exits 0 with all 29+ tests green.

These are hard gates. Do not merge or push to `main` if either fails.
Fix the root cause — never skip hooks or suppress errors.

## Test Layout

```
test/
  emit.test.ts              # unit tests for the SVG emitter
  fixtures/                 # HTML pages used by visual tests
  visual/
    visual.test.ts          # pixel-diff regression tests (smoke, gradients, …)
    lost-content.test.ts    # structural invariant: no visible text node is lost
    images.test.ts          # image capture: paint order, CORS fallback
    element.test.ts         # subtree (single-element) capture
    inpage.test.ts          # in-page backend
    webfont.test.ts         # @font-face embed / outline modes
    __out__/                # generated SVGs (gitignored)
```

Visual tests use `scripts/validate.ts` which renders the SVG in a second Chromium
page and pixel-diffs it against the original. Threshold is per-test (typically < 1–5%).

## Common Pitfalls

- `captureScrollableContent` and `containerRasterFallback` are not passed by the
  Playwright backend (defaults to false). The browser backend passes them explicitly.
- `guaranteeFloor: true` embeds a full-page PNG as a `<image>` base layer (~150–800 KB).
- `diffPatch: true` renders the SVG back in Chromium and patches divergent regions
  with raster screenshots; adds one extra page load per render.
- For CORS images: canvas extraction is tried first (fast, no network), then `fetch`
  with `cache: 'force-cache'`, then in-place raster conversion (Node backend
  screenshots via `page.screenshot`).
