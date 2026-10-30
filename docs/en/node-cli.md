# Node API and CLI

## HTML, URL, or an existing Playwright page

```js
import { htmlToSvg } from './dist/node.js';

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

### Node options

| Option | Default | Description |
| --- | --- | --- |
| `width` | Required | Viewport width in CSS pixels. |
| `height` | Document height | Output height in CSS pixels. When omitted, the backend measures the document and expands the viewport. |
| `deviceScaleFactor` | `1` | Pixel density for the browser context and raster captures; SVG coordinates stay in CSS pixels. For an existing Page, its context controls pixel density. |
| `fontMode` | `'embed'` | `'embed'`, `'outline'`, or `'none'`; see [fonts](fonts.md). |
| `settleMs` | `0` | Extra wait in milliseconds before capture. |
| `executablePath` | Playwright Chromium | Path to a custom Chromium executable. |
| `launchArgs` | Backend defaults | Override Chromium launch arguments. |
| `guaranteeFloor` | `false` | Embed a full-page screenshot beneath the vectors; increases file size and can expose overlap artifacts. |
| `captureSourceHtml` | `false` | With `renderDetailed()`, also return a standalone HTML snapshot (DOM + inlined CSS) as `sourceHtml`, for bug reports. It contains the page's content — share deliberately. |
| `diffPatch` | `false` | Render the SVG back in Chromium, compare it with the page, and overlay raster patches on divergent regions; adds capture work and raster content. |

`guaranteeFloor` and `diffPatch` are optional fidelity tools, not guarantees of a fully vector or exact result.

## CLI

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

The package exposes the same CLI as `fith` when installed or linked. Defaults: width `1280`, scale `1`, font mode `embed`, output `out.svg`. Omit `--height` to use the document height. Set `CHROMIUM_PATH` to select a Chromium executable for the CLI.

The repository also has a development helper, `pnpm render input.html out.svg 1280`, which uses `CHROMIUM_PATH` or the development dependency `@sparticuz/chromium`.
