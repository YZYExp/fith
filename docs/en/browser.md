# Browser library

In a browser project that has fith installed or locally linked, bundle the browser entry:

```ts
import { captureCurrentPage, captureElement } from 'fith/browser';

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
- `rasterize(rect, scale, { element, reason })` supplies screenshot data as a data URI, or `null`. `element` is the element the region belongs to (an `<iframe>`, a `<video>`, a 3D-transformed box…), so a host can answer with a picture it already holds. Without this adapter, regions requiring raster fallback are omitted.
- `idPrefix` (also a Node option) is prepended to every generated id, so several captures can sit in one document without their clip paths, gradients and filters colliding.
- `fonts` is a list of `{ family, weight, style, src, format }` faces (`src` a data URI) to embed instead of reading the document's `@font-face` rules, for frames without network access. It may also be a function `(request) => face | face[] | null` called once per used family, weight and style with `request.chars` (every character set in it), so the host can fetch the file and cut a subset; `null` or a thrown error leaves that family referenced by name. The Node backend takes the same `fonts` option (a function runs on the Node side once the text is known).
- `fontMode: 'outline'` requires an `outline` callback supplied by the caller. The browser entry does not export an outliner factory; setting the mode alone does not convert text to paths.

## What was not drawn as vectors

Regions that become pictures, or are omitted because no screenshot was available, are listed instead of failing silently:

```ts
import { captureElementDetailed } from 'fith/browser';

const { svg, report } = await captureElementDetailed(card);
report.rasters; // { reason, rect, desc, filled: 'screenshot' | 'dom' | 'none' }[]
report.omitted; // the rasters with no pixels at all: blank in the SVG
report.fonts;   // { family, mode: 'embedded' | 'outlined' | 'referenced' }[]
```

`renderDetailed()` in the Node API returns the same `report` next to `svg`.
