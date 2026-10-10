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

### Before opening or updating a PR

`pnpm test` alone is not a sufficient gate. CI's **pull_request** run skips the gated suites, but the
**push** run also executes `extension-e2e`, so a branch can look green on the PR and still go red. Verify
locally, in this order, and only then push or open a PR (never open one on unverified work):

```bash
pnpm build && pnpm build:extension && pnpm test
# gated extension E2E: needs a *full* Chromium (not the headless shell) and a display
EXTENSION_E2E=1 E2E_CHROME_PATH=/path/to/chrome \
  xvfb-run -a pnpm exec vitest run test/visual/extension-e2e.test.ts
```

Re-run all of it after every rebase or merge from `main`. Every new capture behaviour needs a fixture in
`test/fixtures/` plus a test in `test/visual/` (pixel diff **and** a structural assertion such as "this text
is still vector" / "no `data:image/png`"), so a silent fall-back to raster fails the build.

## Real-world Benchmark (`bench/`)

`pnpm bench` runs fith on live sites and on real third-party UI libraries (fetched from npm by
`pnpm bench:fetch`), reporting pixel diff, content-only diff, worst tile, vector-text coverage and raster
area against `bench/baseline.json`. See `bench/README.md`. When a target regresses or looks wrong: compare its
`bench/out/<id>.expected|actual.png`, trace the hotspot with `pnpm inspect <url|file> <x> <y>`, fix, then pin the
behaviour with a fixture + test in `test/visual/realworld-regressions.test.ts` and update the baseline.


### Capture rules learned from the real-world bench (each one was a real regression)

- **`transparent()` must test alpha, not a `, 0)` suffix** — `rgb(255, 153, 0)` (blue = 0) once vanished.
- **Radii**: resolve `%` against the box, keep vertical radii (`radiiY`) for ellipses, and let `roundedRectPath` scale
  *all* radii like CSS. Never emit `<rect rx>` with a huge radius unclamped (a 9999px pill becomes a lens).
- **Transform matrices keep 6 decimals** (`rotate(-1deg)` rounded to 2 decimals is 1.15°).
- **2D rotate/skew** = clear the transform, measure the untransformed subtree, wrap in `<g transform>`; anything that
  needs a screenshot inside throws `TransformBail` and the element falls back to the old raster. Always restore the
  inline `style` attribute in a `finally`.
- **Stacking contexts**: z-indexed descendants belong to the nearest stacking context, not their parent. `<body>`'s
  background propagates to the canvas when `<html>` has none.
- **Groups** (`Scene.groups`) are for effects that composite a *subtree as a unit* (`filter`, `mix-blend-mode`). Per-node
  tagging (`masks`, `clipShapes`, `layers`) is fine only for effects that distribute over children. Never re-filter a
  raster node (its screenshot already contains the effect).
- **Fonts**: `@font-face` `url()` resolves against the *stylesheet*, not the page; walk `@media/@supports/@layer/@import`;
  CDN sheets are opaque to `cssRules` — the Node backend supplies their text (`externalCss`). Carry
  `font-feature-settings` / `font-variation-settings` / `font-stretch` on `<text>`.
- **Backgrounds**: the gradient fast path is only valid for default origin/clip/attachment; everything else goes through
  the layer engine (`<pattern>` tiles). `image, color` shorthands produce a `none` layer.
- **Screenshots as "ground truth" hide raster use**: always read *raster area* and *text coverage* next to the diff.
- **Harness**: use the backend defaults (`captureScrollableContent` false); freeze animations, scroll for lazy loading,
  bound every `img.decode()`; measure page `drift` and don't gate `unstable` targets; never pause CDP virtual time
  (Playwright screenshots deadlock); tests must not use `filter`/radial gradients/canvas as their "needs raster"
  example any more — use 3D transforms or `mask-composite: exclude`.

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
    raster-fallback.test.ts # in-page DOM (foreignObject) raster fallback, no screenshot backend
    scroll-element.test.ts  # element export from a scrolling app-shell sidebar (unfurl, zero-height <body>)
    webfont.test.ts         # @font-face embed / outline modes
    source-html.test.ts     # captureSourceHtml: sanitization, element mode, re-render pixel match
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
    current-viewport crop (origin = scroll position); off-screen raster is then re-rendered
    in-page by the DOM rasterizer fallback instead of being omitted.
- `containerRasterFallback` is **always false for the extension**: a screenshot of a
  container includes its children, so rastering it as a base layer then vectoring the
  children on top double-paints → ghosting. Pseudo-elements are vectorized by
  `tryPseudoBox`; other un-vectorizable container effects are left as best-effort vector.
- `captureScrollableContent` and `containerRasterFallback` are not passed by the
  Playwright backend (defaults to false). The browser backend passes
  `captureScrollableContent` only in full-page scope (not viewport-only).
- In-page backends (`src/backends/browser`) re-render regions with no screenshot via `dom-raster.ts`
  (clone + inlined computed styles → SVG `<foreignObject>` → canvas). Known limits: blend modes need
  the backdrop, filter overflow outside the element box is clipped, iframes render empty.
- **Prefer vectorizing over rastering — raster is the last resort** (it is lost wherever no screenshot
  exists, and is not selectable/scalable). Current vector paths: `mask-image` linear-gradient (px/`calc()`
  stops resolved against the gradient line) → `NodeBase.masks` → SVG `<mask>`; `mask-image:url()` →
  alpha `<mask>` over an embedded base64 image; single-layer `background-image:url()` → placed `<image>`;
  `::before`/`::after` with text content (icon fonts) → `materializePseudo` (temporary real `<span>`
  carrying the pseudo's computed style, captured as box+text, then removed). Anything these can't
  reproduce exactly (multi-layer, tiling, custom origin/clip) deliberately falls back to raster.
- **Bundled extension scripts must not contain Unicode noncharacters** (U+FFFE, U+FFFF, U+FDD0–FDEF).
  A regex literal like `/[\uFFFE\uFFFF]/` is emitted raw by esbuild and Chrome then refuses to inject the
  script ("isn't UTF-8 encoded"), silently breaking the extension. Build such characters at runtime with
  `String.fromCharCode`; `test/extension-bundle.test.ts` enforces this.
- **Tests share one Chromium path**: `test/global-setup.ts` resolves `@sparticuz/chromium` once and
  exports `CHROMIUM_PATH`. Never call `sparticuz.executablePath()` per test (parallel workers re-extract
  the binary → `spawn ETXTBSY` on CI). Launch one browser per file (`beforeAll`) and avoid
  `--single-process`, which made `page.screenshot` flaky on loaded runners.
- **Element (subtree) capture rules** — both caused real "export is empty / truncated" bugs on app shells
  (claude.ai sidebar): (1) ancestors of the picked element are *context only*: never cull them by their own
  bounding box (`<body>` is 0px tall when the shell is `position:fixed`) and never let their `overflow` clip the
  root's content; (2) vertically-scrolling containers inside the root are temporarily "unfurled" to full content
  height (`unfurlScrollContainers`, default on) so the export holds the whole list, not the visible window. The
  unfurl writes inline styles through the `style` *attribute* (a CSSOM edit leaves `style=""` behind in Chrome)
  and restores attribute + scroll positions in a `finally` — keep it that way so a failed capture can't leave the
  user's page re-laid-out.
- `captureScene`'s `rasterElements` option is an **in-page-only out-parameter** (Map, not serializable);
  the Playwright backend never passes it.
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
  browser entry, and the extension popup (`fhSource` pref → `<name>.source.html` download). The extension's **Export element HTML**
  (`fh:pickHtml` message, popup button, context menu) reuses the picker and downloads only the element's snapshot — no SVG.
