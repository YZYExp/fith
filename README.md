# fith — HTML to SVG

**Turn rendered HTML into a portable, vector-first SVG.**

[English](./README.md) · [简体中文](./README.zh-CN.md)

fith uses the browser's computed layout to capture HTML pages and elements as SVG. Text, boxes, borders, gradients, and supported effects become SVG graphics; complex regions can fall back to embedded screenshots when the backend provides them.

Use it to export UI cards, dashboards, documentation illustrations, and page snapshots from the HTML you already have. The output is a static SVG, with images and captured raster regions inlined into one file. Font handling is configurable.

> Vector-first does not mean entirely vector or pixel-perfect for every page. Fidelity depends on the page, fonts, capture backend, and SVG viewer. See [supported content and limitations](#supported-content-and-limitations).

## Example

The repository includes a [sample HTML card](./homepage/public/examples/card.html) and its [SVG output](./homepage/public/examples/card.svg).

| HTML screenshot | SVG output |
| --- | --- |
| ![Screenshot of the sample HTML card](./homepage/public/examples/card.png) | ![SVG conversion of the sample HTML card](./homepage/public/examples/card.svg) |

## Name and naming philosophy

**fith** is short for **fitting HTML**: `fit` means fitting, and `h` stands for HTML.
The name comes from the idea of fitting anything; this project focuses on
reconstructing the visual appearance of rendered HTML as SVG.

## Highlights

- **Browser layout.** Reuse the browser's layout engine instead of reimplementing HTML and CSS layout.
- **Vector-first output.** Preserve supported text and graphics as SVG elements, with local raster fallback for complex content.
- **Portable assets.** Inline images and readable `@font-face` fonts, or convert supported glyphs to paths.
- **Three environments.** Use the Node API/CLI, a browser library, or a Chrome Manifest V3 extension. All share the same DOM capture and SVG emission core.
- **Measurable fidelity.** Compare the original HTML and generated SVG in Chromium with the included pixel-diff tools.

## Quick start

### Build from source

Requires **Node.js 18+** and **pnpm**. The repository pins pnpm in `package.json`; CI uses Node.js 22. The Node backend also requires Chromium.

```bash
git clone https://github.com/0x0079/fith.git
cd fith
pnpm install
pnpm exec playwright install chromium
pnpm build
```

On Linux, use `pnpm exec playwright install --with-deps chromium` if browser system dependencies are missing.

Convert the included example from the repository root:

```bash
node dist/backends/node/cli.js homepage/public/examples/card.html \
  -o card.svg --width 520 --height 360 --font-mode embed
```

The instructions here use a source checkout; they do not require an npm release or a Chrome Web Store listing.

### Node API

Save this as `convert.mjs` in the repository root and run `node convert.mjs`:

```js
import { writeFile } from 'node:fs/promises';
import { htmlToSvg } from './dist/index.js';

const svg = await htmlToSvg(
  '<html><body><h1>Hello, SVG</h1><p>Made from HTML.</p></body></html>',
  { width: 800, height: 300, fontMode: 'embed' },
);

await writeFile('page.svg', svg, 'utf8');
```

When fitting-html is installed or linked into another project, import from `fitting-html` instead of `./dist/index.js`.

## Usage

### HTML, URL, or an existing Playwright page

```js
import { htmlToSvg } from './dist/index.js';

// A bare string is HTML. URLs must use the { url } form.
const fromHtml = await htmlToSvg('<h1>Hello</h1>', { width: 1280 });
const fromUrl = await htmlToSvg(
  { url: 'https://example.com' },
  { width: 1280, height: 720 },
);

// With an existing Playwright Page, prepare the page before capture:
// await page.goto(...); await page.waitForSelector(...);
// const fromPage = await htmlToSvg({ page }, { width: 1280 });
```

The Node backend waits for `networkidle` when loading HTML or a URL, and for `document.fonts.ready` before capture. Use `settleMs` for an additional delay, or supply an already prepared Playwright page for authenticated or dynamic content. Capturing an existing page changes its viewport; its browser remains owned by the caller.

HTML strings and CLI file input are loaded with `page.setContent`, without a file-based origin. For relative images, stylesheets, or scripts, use absolute URLs, an explicit `<base href>`, or serve the page over HTTP and capture its URL.

#### Node options

| Option | Default | Description |
| --- | --- | --- |
| `width` | Required | Viewport width in CSS pixels. |
| `height` | Document height | Output height in CSS pixels. When omitted, the backend measures the document and expands the viewport. |
| `deviceScaleFactor` | `1` | Pixel density for the browser context and raster captures; SVG coordinates stay in CSS pixels. For an existing Page, its context controls pixel density. |
| `fontMode` | `'embed'` | `'embed'`, `'outline'`, or `'none'`; see [fonts](#fonts). |
| `settleMs` | `0` | Extra wait in milliseconds before capture. |
| `executablePath` | Playwright Chromium | Path to a custom Chromium executable. |
| `launchArgs` | Backend defaults | Override Chromium launch arguments. |
| `guaranteeFloor` | `false` | Embed a full-page screenshot beneath the vectors; increases file size and can expose overlap artifacts. |
| `captureSourceHtml` | `false` | With `renderDetailed()`, also return a standalone HTML snapshot (DOM + inlined CSS) as `sourceHtml`, for bug reports. It contains the page's content — share deliberately. |
| `diffPatch` | `false` | Render the SVG back in Chromium, compare it with the page, and overlay raster patches on divergent regions; adds capture work and raster content. |

`guaranteeFloor` and `diffPatch` are optional fidelity tools, not guarantees of a fully vector or exact result.

### CLI

Run the compiled CLI directly from the checkout:

```bash
node dist/backends/node/cli.js input.html -o out.svg \
  --width 1280 --scale 2 --font-mode outline

node dist/backends/node/cli.js https://example.com \
  -o example.svg --width 1280 --height 720

# also write a reproducible source snapshot for a bug report
node dist/backends/node/cli.js https://example.com \
  -o example.svg --source-html example.source.html
```

The Chrome extension offers the same snapshot under *Text, fonts & bug reports → Also save source HTML* (off by default).
For feedback on a single element, use **Export element HTML** in the popup (or the context menu entry): pick an element and only its `.source.html` snapshot is downloaded.

The package exposes the same CLI as `fitting-html` when installed or linked. Defaults: width `1280`, scale `1`, font mode `embed`, output `out.svg`. Omit `--height` to use the document height. Set `CHROMIUM_PATH` to select a Chromium executable for the CLI.

The repository also has a development helper, `pnpm render input.html out.svg 1280`, which uses `CHROMIUM_PATH` or the development dependency `@sparticuz/chromium`.

### Browser library

In a browser project that has fitting-html installed or locally linked, bundle the browser entry:

```ts
import { captureCurrentPage, captureElement } from 'fitting-html/browser';

const pageSvg = await captureCurrentPage({ fontMode: 'embed' });
const visibleSvg = await captureCurrentPage({ viewportOnly: true });

const card = document.querySelector('.card');
if (card) {
  const cardSvg = await captureElement(card, { fontMode: 'embed' });
  console.log(cardSvg);
}
```

The browser library uses DOM APIs without Node or Playwright at runtime. It captures the current layout; `width` and `height` control capture dimensions rather than creating a new browser viewport.

- `viewportOnly: true` captures the current viewport for page captures; the default is the full document. Element capture crops to the selected subtree.
- `rasterize(rect, scale)` supplies screenshot data as a data URI, or `null`. Without this adapter, regions requiring raster fallback are omitted.
- `fontMode: 'outline'` requires an `outline` callback supplied by the caller. The browser entry does not export an outliner factory; setting the mode alone does not convert text to paths.

### Chrome extension

```bash
pnpm build:extension
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/extension/`.

- Capture the **visible area** (default), **full page**, or **a picked element**.
- Choose download, preview, or both. The preview includes zoom and background controls.
- Pick an element from the popup, with `Alt+Shift+S`, or through the context menu; press `Esc` to cancel selection.
- Choose `embed` or `none` for fonts. Outline mode is currently unavailable in the extension.

The extension does not scroll the document to stitch screenshots. Visible-area raster fallback uses `captureVisibleTab`. Full-page raster fallback can use the optional **debugger** permission for regions beyond the viewport. If that permission is declined, off-screen raster regions are omitted while supported vectors can still be exported. Browser internal pages and extension store pages cannot be captured.

The manifest requests `activeTab`, `tabs`, `scripting`, `contextMenus`, `storage`, and `<all_urls>` host access; `debugger` is optional. See the [manifest](./src/backends/extension/manifest.json) for the exact permissions.

## Fonts

| Mode | Behavior | Tradeoff |
| --- | --- | --- |
| `embed` | Keep SVG text and inline readable `@font-face` font data. | Text remains selectable; system fonts are not automatically embedded. Font loading and cross-origin access can affect the result. |
| `outline` | Convert glyphs to SVG paths when a usable font is available. | Converted text loses text selection and editing. Missing or unsupported fonts can fall back to SVG text. |
| `none` | Reference font families by name. | Rendering depends on fonts installed in the viewer's environment. |

Node outline mode resolves system fonts through `fontconfig` (`fc-match`). Install fontconfig and the needed fonts when using this path, particularly on Linux. Font formats and complex text shaping can limit outline fidelity; verify the actual output. Only embed or redistribute fonts and other assets you have permission to share.

## Supported content and limitations

**Vector support includes:** box backgrounds; borders and rounded corners; outer shadows; outlines; linear gradients; line-positioned text with spacing, decoration, case transforms, ellipsis, and gradient fills; list markers; inline SVG; images with `object-fit`; supported decorative pseudo-elements; overflow clipping; opacity; translation and scaling; modern CSS colors converted to sRGB; open shadow DOM and `display: contents`.

**Raster fallback candidates include:** radial, conic, and layered gradients; inset shadows; filters and backdrop filters; blend modes; masks and clip paths; rotated, skewed, or 3D transforms; native form controls; canvas, video, iframe, closed shadow DOM, and images that cannot be read directly.

Coverage depends on the backend and DOM structure. In particular:

- The browser library and extension disable container raster fallback to avoid double-painting children; some complex container effects are captured on a best-effort basis.
- Full-document browser/extension capture expands scroll-container content; viewport-only capture preserves the current view. Node capture uses its own viewport sizing, so outputs can differ.
- Capture produces a static snapshot. Interactivity, application logic, animation, and lazy-loaded content that has not rendered are not preserved.
- A single SVG file can contain raster images. Font availability, cross-origin resources, and viewer support still affect portability and appearance.
- Chromium pixel comparisons measure Chromium rendering. Check the output in the SVG viewer or design tool you intend to use.

## How it works

```text
Rendered HTML → DOM capture → Scene IR → SVG emitter → SVG file
                                  ↑
                       Backend raster captures
```

The browser computes layout. The capture core reads DOM geometry and computed styles into a scene representation; the emitter translates that scene into SVG. Backends supply browser access, screenshots, and font resolution where available.

| Directory | Purpose |
| --- | --- |
| `src/core/` | DOM capture, scene types, SVG emission; no Node runtime dependency. |
| `src/backends/node/` | Playwright integration, font resolution, CLI, and diff patches. |
| `src/backends/browser/` | In-page API and raster adapter utilities. |
| `src/backends/extension/` | Manifest V3 popup, capture worker, content script, and viewer. |
| `test/` | Unit tests, HTML fixtures, and visual regression tests. |
| `examples/` | Ant Design and MUI example applications. |
| `homepage/` | Project website and sample assets. |

See [DESIGN.md](./DESIGN.md) for implementation details and [fidelity research](./docs/fidelity-research.md) for additional investigation. These documents are currently in Chinese.

## Development and validation

```bash
pnpm build
pnpm build:extension
pnpm test

# Compare your own HTML or URL with its SVG render
pnpm validate ./homepage/public/examples/card.html card 520 360 embed
pnpm validate https://example.com example 1280 720

# Build, serve, and compare the example applications
pnpm validate:example antd-app 1280
pnpm validate:example mui-app 1280
```

Validation writes `<name>.svg`, `<name>.expected.png`, `<name>.actual.png`, and `<name>.diff.png` to `test/visual/__out__/`. Example validation exits with a failure if the pixel-diff ratio exceeds `FH_THRESHOLD` (default `0.02`, or 2%); set `FH_THRESHOLD=0.01` for a 1% threshold. The standalone `pnpm validate` command reports the diff without applying that threshold.

Development and visual-test helpers use `@sparticuz/chromium` or `CHROMIUM_PATH`; the production Node API uses Playwright Chromium unless `executablePath` is supplied.

Optional suites:

```bash
# Requires a Chromium build capable of loading extensions
EXTENSION_E2E=1 pnpm exec vitest run test/visual/extension-e2e.test.ts

# Requires access to external sites
REALWORLD_TESTS=1 pnpm exec vitest run test/visual/realworld.test.ts
```

[CI](./.github/workflows/ci.yml) builds TypeScript and the extension and runs the test suite for pull requests to `main` and configured push branches. The full extension E2E job runs on configured pushes.

## Contributing

[Issues](https://github.com/0x0079/fith/issues) and pull requests are welcome. For rendering bugs, include a minimal HTML reproduction, capture backend, viewport dimensions, font mode, and screenshots or validation artifacts.

For rendering changes, add a focused fixture or regression test. Run `pnpm build`, `pnpm build:extension`, and `pnpm test` before submitting. Use PR titles such as `docs(readme): improve bilingual setup instructions` or `bugfix(capture): preserve clipped text`.

## License

Licensed under the **Mozilla Public License 2.0 (MPL-2.0)**. See [LICENSE](./LICENSE) for the full text. Font, image, and captured page content retain their respective licenses.
