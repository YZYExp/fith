# CSS effects → SVG: catalog, evidence and status

Goal: keep pages **vector** (selectable, scalable, small) wherever SVG can express the effect, and fall back to a raster
screenshot only when it cannot. This file is the working catalog; each technique is meant to become an independent
emitter *component* later (see [Componentization plan](#componentization-plan)) — not urgent.

**Evidence** comes from the effects lab (`pnpm bench:effects`, `bench/effects/lab.ts`): for every row it renders the real
CSS and the candidate SVG in the same Chromium and pixel-diffs them (240×140, threshold 0.1). Reports:
`bench/out/effects/report.md` + `*.css.png` / `*.svg.png`. Real-site impact is tracked in
[bench-log.md](bench-log.md). Lab numbers < ~2 % are anti-aliasing/position noise of the hand-written lab SVG, not a
limitation of the technique.

Status legend: ✅ shipped · 🔧 technique proven in the lab, not wired into capture yet · 🧭 planned/needs design · ⛔ cannot be matched in SVG (recorded).

## 1. Paint (backgrounds, borders, shadows)

| CSS | SVG technique | lab diff | status in fith |
|---|---|---|---|
| `linear-gradient` (angle, `to corner`, px/% stops, alpha) | `<linearGradient userSpaceOnUse>`; corner keywords computed from the box aspect; alpha stops re-sampled in premultiplied space | – (fixture `gradients-advanced`) | ✅ |
| `radial-gradient` (circle/ellipse, size keywords, `at`) | `<radialGradient>` + `gradientTransform` scale for ellipses | – | ✅ |
| `repeating-linear-gradient` | `spreadMethod="repeat"` over one period | – (fixture `clip-conic-repeat`) | ✅ |
| `conic-gradient` | no primitive → 180 painter's-algorithm pie slices (each slice covers the rest of the turn ⇒ every seam anti-aliased once) | – | ✅ (file-size cost ≈ 18 KB / gradient) |
| multi-layer backgrounds | stack of fills bottom→top | – | ✅ (only default-sized layers) |
| tiled / sized / positioned / clipped layers, url()+gradient mixes, `image-set`, `fixed` | `<pattern>` tile per layer + clip box | – (fixture `bg-layers`) | ✅ (`space`/`round`, non-sRGB interpolation ⇒ raster) |
| `box-shadow` (outer, blur, spread) | blurred shape under an inverse mask | – | ✅ |
| `box-shadow: inset` sharp | evenodd ring clipped to the padding box | 0.00 % (`inset-blur-shadow`) | ✅ |
| `box-shadow: inset` with blur | same ring + `feGaussianBlur`, clipped to the padding box | **0.00 %** | ✅ |
| `border-radius` incl. `%` | rounded-rect path; `%` resolved against the box | – | ✅ |
| mixed-width / mixed-colour borders, CSS triangles | mitered per-edge trapezoids (+ rounded ring clip) | – (fixture `pseudo-flow`) | ✅ |
| `border-style: double/groove/ridge` | two strokes / light+dark strokes | – | 🧭 (raster today) |
| `border-image` | 9-slice with clipped `<image>` copies | – | 🧭 |
| `outline` | stroke outside the border box | – | ✅ |
| `background-image:url()` (single, sized/positioned) | `<image>` | – | ✅ |
| `image-rendering: pixelated` | `image-rendering="pixelated"` on `<image>` | – | 🧭 |

## 2. Compositing and filters

| CSS | SVG technique | lab diff | status |
|---|---|---|---|
| `filter: blur(r)` | `feGaussianBlur stdDeviation=r` (region = box ± 3r) | – | ✅ (childless boxes/pseudos only) |
| `filter: grayscale/sepia/saturate/hue-rotate` | `feColorMatrix` (spec matrices) | grayscale **0.00 %**, hue-rotate **0.00 %** | ✅ (subtree group) |
| `filter: brightness/contrast/invert/opacity` | `feComponentTransfer` (`linear`/`table`) | **0.00 %** | ✅ |
| `filter: drop-shadow()` | `feDropShadow` (σ = blur/2) | 0.28 % | ✅ |
| `filter` on a *subtree* | one `<g filter>` around all member nodes (`Scene.groups`) | – (fixture `filter-blend-groups`) | ✅ |
| `filter: url(#svgFilter)` | copy the referenced `<filter>` into `<defs>` | – | 🧭 |
| `mix-blend-mode` | `style="mix-blend-mode:…"` on the node group | multiply **0.00 %**, difference (text) 1.08 % | ✅ — blends against the SVG's own earlier content, which is exactly the backdrop we emit |
| `backdrop-filter: blur()` | re-emit everything painted *below* inside `<g clip-path=box><g filter=blur>…</g></g>` (`BackgroundImage` is unsupported in browsers); can reference one shared `<g id>` via `<use>` | **0.21 %** | 🔧 — today the blur is dropped (box stays vector) |
| `opacity`, `isolation` | group `opacity`; `isolation:isolate` | – | ✅ / 🧭 |
| `mask-image` linear / `url()` | `<mask>` alpha | – | ✅ |
| `mask-image` radial / multi-layer, `mask-composite: add/intersect` | radial `<mask>`; union in one mask, intersect as nested masks | – (fixture `mask-layers`) | ✅ |
| `mask-composite: exclude/subtract`, `mask-size`/`mask-clip` layers (gradient-border trick) | luminance trick / per-layer clip | – | 🧭 |
| `clip-path: inset/circle/ellipse/polygon` | `<clipPath><path>` on the group | – | ✅ |
| `clip-path: path()` / `url(#svgClip)` | embed path / copy `<clipPath>` | – | 🧭 |

## 3. Text

| CSS | SVG technique | lab diff | status |
|---|---|---|---|
| color, size, weight, style, letter/word-spacing | `<text>` attrs | – | ✅ |
| `font-feature-settings`, `font-variation-settings`, `font-stretch`, `text-rendering` | inline `style` on `<text>` | – (fixture `cdn-font`) | ✅ |
| webfonts | embedded base64 `@font-face` incl. `unicode-range`, cross-origin CSS fetched by Node | – | ✅ |
| `text-transform`, `white-space: pre`, ellipsis | transformed string, `xml:space`, truncated string | – | ✅ |
| `background-clip:text` gradient | gradient `fill` on `<text>` | 3.53 % (lab geometry only) | ✅ |
| `-webkit-text-stroke` / `paint-order` | `stroke` + `stroke-width`, `paint-order="stroke fill"` | 1.63 % | 🔧 |
| `text-shadow` | per-shadow blurred duplicate `<text>` or `feDropShadow` (σ = blur/2) | 4.92 % (needs tuning of filter region/offset) | 🔧 |
| `text-decoration` solid/underline/line-through | `text-decoration` attr | – | ✅ |
| `text-decoration: wavy/dotted/dashed` | stroked path / `stroke-dasharray` | 1.57 % (wave phase) | 🔧 |
| `writing-mode: vertical-*` | `writing-mode` + `glyph-orientation` | – | 🧭 |
| `direction: rtl` / bidi | `direction`, `unicode-bidi` (+ per-run x) | – | 🧭 (text inputs with rtl stay raster) |
| `text-align: justify` | per-word x (we have per-char x in outline mode) | – | 🧭 |
| `-webkit-line-clamp` | string truncation + ellipsis | – | 🧭 |
| `::first-letter` / `::first-line` | per-run style from per-char Ranges | – | 🧭 |
| colour emoji | `<text>` with emoji font, or raster glyph | – | ⛔ partially (font availability differs) |

## 4. Geometry

| CSS | SVG technique | lab diff | status |
|---|---|---|---|
| uniform `scale()` | scale text/spacing by the measured ratio | – | ✅ |
| `rotate()/skew()/matrix()` (2D) | `<g transform>` about the transform-origin; measured with the transform temporarily cleared; matrix keeps 6 decimals | rotate 0.77 %, skew **0.00 %** | ✅ (bails to raster when a screenshot is needed inside, or the element animates) |
| `perspective` / `rotateX/Y` / `matrix3d` | SVG has only affine transforms | – | ⛔ true perspective cannot be expressed; trivial-perspective cases can be flattened, the rest stay raster |
| `position: sticky/fixed` | static snapshot at scroll 0 | – | ✅ |
| `object-fit/position`, `border-radius` on `<img>` | `preserveAspectRatio` + clip | – | ✅ |
| z-index / stacking contexts | hoist z-indexed descendants to the nearest stacking context | – | ✅ (positioned `z:auto` pseudo ordering 🧭) |

## 5. Replaced / native content

| CSS/HTML | SVG technique | status |
|---|---|---|
| text `<input>` | rect + `<text>` | ✅ |
| `checkbox/radio/range/progress/meter/select` | drawn primitives matching Chrome's native look (themeable by `accent-color`) | 🧭 (raster today) |
| `<canvas>` (2D) | `toDataURL` → `<image>` | ✅ (tainted / blank WebGL ⇒ raster) |
| `<video>` / `<iframe>` | current frame / recursive capture (same-origin iframes) | ⛔ / 🧭 |
| inline `<svg>`, `<img src=svg>` | transplanted markup with inlined styles | ✅ |

## Recorded: cannot be made identical (accept & document)

| item | why | mitigation |
|---|---|---|
| Sub-pixel/LCD text anti-aliasing, hinting | the SVG is re-rasterised by the viewer; glyph rasterisation differs per renderer | `fontMode: 'outline'` makes glyph shapes deterministic; expect 1–5 % text-edge diff |
| Real 3D perspective | SVG is affine-only | raster fallback |
| `video`, WebGL canvas, cross-origin iframes | pixels are not in the DOM | raster (screenshot) |
| Animated/transitioning states, `:hover` | a static snapshot is captured | settle time; `animations: 'disabled'` for the reference |
| System fonts absent from the viewer | text falls back | embed webfonts; outline for system fonts |
| Native form widgets across OS themes | look is OS-dependent | raster or draw Chrome-like primitives |
| Live content (ads, counters, carousels) | differs between the reference screenshot and the capture | `--repeat` median; document per target |
| `backdrop-filter` is only exact when everything beneath is vector | beneath-raster ⇒ blur of a screenshot | emulate when the content below is vector; else keep the box without blur |

## Componentization plan

Not started (by design — correctness first). The catalog suggests this split, each unit owning *capture parse → IR →
SVG emit → lab case → fixture test*:

```
src/core/effects/
  gradients/   linear · radial · conic · repeating · layers · pattern(tiles)
  filters/     blur · color-matrix(grayscale…hue) · component-transfer · drop-shadow · url(#)
  blend/       mix-blend-mode + isolation grouping
  backdrop/    re-emit-below + blur + clip
  shadows/     outer · inset(sharp/blurred) · text-shadow
  clip-mask/   clip-path shapes · mask-image variants
  transform/   2D matrix wrapper (measure-untransformed) · scale handling
  text/        stroke · decorations · features/variations
  native/      checkbox · radio · range · progress · select
```

Each component exposes `parse(el, cs) → IR fragment | null` (null = unsupported → raster) and `emit(fragment, defs) → svg`,
plus a `lab` case. The lab (`bench/effects/lab.ts`) already isolates the technique half; the capture half is today
inlined in `capture.ts` (which must stay a single self-contained function because it is `.toString()`-injected — the
components would be concatenated at build time rather than imported).
