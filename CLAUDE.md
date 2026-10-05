# fith — Development Guide

## Project Overview

**fith** (short for **fitting HTML**: `fit` + `h`) converts rendered HTML pages
or elements into self-contained, vector-first SVG files. The name comes from the
idea of fitting anything; this project focuses on HTML visual reconstruction.

Use **fith** as the project display name. Repository links target the planned
rename to `https://github.com/0x0079/fith`. The package name and CLI command
currently remain `fitting-html`; imports and command examples must match those
actual identifiers.

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

The project uses **pnpm** (`packageManager` field; CI uses pnpm too).

```bash
pnpm build            # TypeScript compile (tsc)
pnpm build:extension  # esbuild MV3 bundle → dist/extension/
pnpm test             # Vitest — all visual + unit tests
pnpm validate <url|file> [name] [w] [h] [fontMode]   # ad-hoc pixel-diff of any page
pnpm validate:example <antd-app|mui-app>             # build + serve + pixel-diff an example
```

CI (`.github/workflows/ci.yml`) runs build + extension bundle + full test suite on
every push/PR; the gated extension E2E job runs on pushes only.

## Acceptance Criteria

**Every commit and PR must satisfy:**

1. **Build passes**: `pnpm build` exits 0 with no TypeScript errors.
2. **Tests pass**: `pnpm test` exits 0 with all tests green (50+, plus gated suites).

These are hard gates. Do not merge or push to `main` if either fails.
Fix the root cause — never skip hooks or suppress errors.

## Test Layout

```
test/
  emit.test.ts              # unit tests for the SVG emitter
  viewport-raster.test.ts   # pure unit: createViewportRasterizer (origin offset,
                            #   shootRegion precedence, off-screen → null)
  shot-scheduler.test.ts    # pure unit: createShotScheduler rate-limit/retry (virtual clock)
  extension-bundle.test.ts  # builds the MV3 bundle, asserts manifest/file integrity
  fixtures/                 # HTML pages used by visual tests
  visual/
    visual.test.ts          # pixel-diff regression tests (smoke, gradients, …)
    lost-content.test.ts    # structural invariant: no visible text node is lost
    images.test.ts          # image capture: paint order, CORS fallback
    element.test.ts         # subtree (single-element) capture
    inpage.test.ts          # in-page backend
    source-html.test.ts     # captureSourceHtml: sanitization, element mode, re-render pixel match
    webfont.test.ts         # @font-face embed / outline modes
    extension-viewport.test.ts # drives the shared createViewportRasterizer end-to-end
                            #   (single shot, no scroll) with a Playwright pngjs env
    extension-runtime.test.ts # built content/popup/viewer scripts in Chromium with
                            #   API shims; worker preview handoff with Chrome mocks
    extension-e2e.test.ts   # gated (EXTENSION_E2E=1): loads the real extension into a
                            #   full Chromium and exercises the full download pipeline
    realworld.test.ts       # gated (REALWORLD_TESTS=1): live external URLs
    __out__/                # generated SVGs (gitignored)
```

Visual tests use `scripts/validate.ts` which renders the SVG in a second Chromium
page and pixel-diffs it against the original. Threshold is per-test (typically < 1–5%).

**Extension testing layers:** pure logic (`viewport-raster`, `shot-scheduler`) →
in-page integration (`extension-viewport.test.ts`, which runs the *shared*
`createViewportRasterizer` so production code is covered, not a copy) → gated full
E2E (`extension-e2e.test.ts`, needs a full Chromium that can load extensions — set
`E2E_CHROME_PATH` or install a Playwright "Chrome for Testing"; the headless shell
used by other tests can't load extensions).

## Common Pitfalls

- **The extension never scrolls the page** — scrolling triggers sticky/fixed
  repositioning, lazy-load, and scroll animations, corrupting captures (these target
  relatively static pages). Both popup **scopes** rasterize via the shared
  non-scrolling `createViewportRasterizer`:
  - "Visible area" (default): viewport-only vector + a single `captureVisibleTab`
    crop; coords viewport-relative (`viewportOnly: true`, origin {0,0}), off-screen
    content culled at capture time.
  - "Full page": full-document vector (no scroll needed for vector) + raster from
    either an exact `chrome.debugger` `Page.captureScreenshot`
    (`captureBeyondViewport`, reaches below the fold in one shot — optional
    `debugger` permission, requested by the popup) or, if not granted, a
    current-viewport crop (origin = scroll position, off-screen raster omitted).
- `containerRasterFallback` is **always false for the extension**: a screenshot of a
  container includes its children, so rastering it as a base layer then vectoring the
  children on top double-paints → ghosting. Pseudo-elements are vectorized by
  `tryPseudoBox`; other un-vectorizable container effects are left as best-effort vector.
- `captureScrollableContent` and `containerRasterFallback` are not passed by the
  Playwright backend (defaults to false). The browser backend passes
  `captureScrollableContent` only in full-page scope (not viewport-only).
- `guaranteeFloor: true` embeds a full-page PNG as a `<image>` base layer (~150–800 KB).
- `diffPatch: true` renders the SVG back in Chromium and patches divergent regions
  with raster screenshots; adds one extra page load per render.
- For CORS images: canvas extraction is tried first (fast, no network), then `fetch`
  with `cache: 'force-cache'`, then in-place raster conversion (Node backend
  screenshots via `page.screenshot`).

## Source-HTML Snapshot (bug-report capture)

`captureSourceHtml()` (`src/core/capture/source-html.ts`) serializes the rendered page — or one
element plus its ancestor chain — into a standalone `.source.html`, so a bad capture can be
reproduced offline and promoted to a fixture in `test/fixtures/`.

- Like `captureScene` it runs **in-page and is serialized via `.toString()`** for Playwright:
  fully self-contained, no imports, every helper inside the function body.
- It inlines accessible stylesheets (adopted sheets and `@import` included, relative `url()`
  made absolute), pins `<base href>`, keeps canvas pixels, form state, `<img>` `currentSrc` and
  open shadow DOM (declarative `<template shadowrootmode>`), and writes a `fith-capture` meta
  (viewport, dpr, scroll, UA, color scheme) so the page re-renders at the same size.
- It strips scripts, `on*` handlers, `javascript:` URLs, preload hints and password values.
  Sanitize **every** clone, including the shallow ancestor shells in element mode (a regression
  here once left `onload` on `<body>`).
- **Privacy:** the snapshot contains the page's visible content. Keep it strictly opt-in (CLI
  `--source-html`, `captureSourceHtml` render option, the extension's unchecked-by-default
  checkbox) and never commit a user-supplied snapshot as a fixture without scrubbing it.
- Entry points: `renderDetailed()` / `--source-html` (Node), `captureSourceHtml` from the
  browser entry, and the extension popup (`fhSource` pref → `<name>.source.html` download).
