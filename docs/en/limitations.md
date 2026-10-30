# Supported content and limitations

**Vector support includes:** box backgrounds; borders and rounded corners; outer shadows; outlines; linear gradients; line-positioned text with spacing, decoration, case transforms, ellipsis, and gradient fills; list markers; inline SVG; images with `object-fit`; supported decorative pseudo-elements; overflow clipping; opacity; translation and scaling; modern CSS colors converted to sRGB; open shadow DOM and `display: contents`.

**Raster fallback candidates include:** radial, conic, and layered gradients; inset shadows; filters and backdrop filters; blend modes; masks and clip paths; rotated, skewed, or 3D transforms; native form controls; canvas, video, iframe, closed shadow DOM, and images that cannot be read directly.

Coverage depends on the backend and DOM structure. In particular:

- The browser library and extension disable container raster fallback to avoid double-painting children; some complex container effects are captured on a best-effort basis.
- Full-document browser/extension capture expands scroll-container content; viewport-only capture preserves the current view. Node capture uses its own viewport sizing, so outputs can differ.
- Capture produces a static snapshot. Interactivity, application logic, animation, and lazy-loaded content that has not rendered are not preserved.
- A single SVG file can contain raster images. Font availability, cross-origin resources, and viewer support still affect portability and appearance.
- Chromium pixel comparisons measure Chromium rendering. Check the output in the SVG viewer or design tool you intend to use.
