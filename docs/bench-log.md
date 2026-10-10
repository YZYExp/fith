# Real-world benchmark — experiment log

Every experiment on the real-world corpus is recorded here: **hypothesis → change → measurement → verdict**,
newest last. Targets and their latest numbers: [bench-corpus.md](bench-corpus.md). Raw per-run snapshots
(commit, metrics, top raster sources): `bench/history/*.json` (written by `pnpm bench --record=<label>`).

## Method

1. `pnpm bench[:fetch]` renders each target in Chromium, captures a Scene, emits SVG, re-renders the SVG in a
   second page and compares (see [`bench/README.md`](../bench/README.md)).
2. Triage = look at `bench/out/<id>.{expected,actual,diff}.png`, then `pnpm inspect <url|file> <x> <y>` for the
   element + scene node behind a hotspot, and the *top raster sources* the runner prints.
3. Fix in `src/`, pin with a fixture + test in `test/visual/realworld-regressions.test.ts` (pixel diff **and** a
   structural assertion), re-run `pnpm bench`, record, update the baseline.

### Metrics — and why pixel diff alone is misleading
| metric | meaning | caveat |
|---|---|---|
| diff | differing px / all px | diluted by whitespace; **raster fallback screenshots count as "correct"** |
| content diff | differing / non-background px | still blind to *how* it was drawn |
| worst tile | worst 64 px tile's differing fraction | localizes failures the global ratio hides |
| text cov | vector text chars ÷ rendered DOM text chars (inside the captured region, sr-only excluded) | >100 % = text inside inline SVG counted too |
| raster area | raster-node area ÷ viewport | the real vector-first score: lower is better |

Lessons about the metrics themselves (each cost a wrong conclusion once):
- A page can score ~0 % diff while 100 % of it is a screenshot (Apple, antd.design) → always read *raster area* and
  *text cov* with the diff.
- Text coverage must only count the captured region and ignore visually-hidden text, else it under/over-reports.
- Live sites are non-deterministic (BBC measured 0.14 % and 23.7 % on consecutive runs) → `--repeat=3` takes the
  median; compare live numbers only against a median baseline.
- `file://` pages cannot `fetch()` fonts/images → local pages are served over http by the runner.

## Scoreboard: session start → now

Whole-page diff / raster area (viewport share). "start" = first measurement in this log; "now" = baseline `groups-fonts`.
Raster area is the vector-first score; diffs of pages that were mostly screenshots *rose* slightly as real vector
rendering replaced them (see the Stripe note under Negative results).

| target | start diff | now diff | start raster | now raster |
|---|---|---|---|---|
| nodejs.org | 2.94 % | 0.38 % | 10 % | 7 % |
| pypi.org | 2.67 % | 0.17 % | 3 % | 0 % |
| react.dev | – | 0.78 % | 67 % | 0 % |
| apple.com | 1.21 % (text missing) | 0.10 % | 103 % | 0 % |
| bootstrap (getbootstrap.com) | – | 0.13 % | 97 % | 0–3 % |
| Linear | – | 0.40 % | 137 % | 0 % |
| Stripe | – | 0.56 % | 56 % | 0 % |
| Hacker News | 1.69 % | 0.00 % | 0 % | 0 % |
| Leaflet (lib) | 3.47 % | 0.01 % | 0 % | 0 % |
| Reveal.js (lib) | 3.2 % | 0.13 % | 0 % | 0 % |
| Bootstrap dashboard (lib) | 0.40 % | 0.45 % | 23 % | 9 % |
| mean over 67 targets | – | – | ~14 % (E19) | **5.8 %** (run `pseudo-url-3d-flat`) |

Remaining raster, by area over the corpus: `<video>` 4.4 MP, cross-origin `<iframe>` 3.9 MP, 3D transforms 0.8 MP,
`mask-composite: exclude` 0.8 MP, residual pseudo 0.56 MP, form controls 0.12 MP. `<video>`/iframes are inherently pixels.

## Experiments

Numbers are `diff` (whole page) unless stated. "→" = before → after.

| # | target(s) | hypothesis / symptom | change | result | verdict |
|---|---|---|---|---|---|
| E1 | nodejs.org, pypi.org | body text rendered in serif in the SVG | `@font-face` `url()` resolved against the *stylesheet* (was page base); walk `@media/@supports/@layer`; keep `unicode-range` subsets | nodejs 2.94→1.88 %; pypi 2.67→**0.13 %** | ✅ real bug (Next.js/webpack emit `../media/*.woff2`) |
| E2 | nodejs.org code card | `import{{ createServer}}ffrom` — tokens shifted left a space | keep x of the *first non-space glyph* after collapsed leading whitespace | 1.88→1.64 % | ✅ |
| E3 | nodejs.org | green hero blob drawn as a solid disc | `filter: blur(Npx)` on childless boxes / pseudos → `feGaussianBlur` | 1.64→**0.11 %** | ✅ |
| E4 | `<pre>` code | runs of spaces collapsed | `white-space: pre*` kept verbatim, `xml:space="preserve"` | (part of E2/E3) | ✅ |
| E5 | Leaflet | map overlays/markers absent | 0×0 `overflow:visible` containers were culled with their subtree → descend if they have children | content appeared (3.47→3.77 %, now visible mismatch) | ✅ unmasked E6 |
| E6 | Leaflet | overlay shifted by its own translate | inline `<svg>` clone kept its `transform` while the rect already includes it → drop transform/translate/scale/rotate on the clone | 3.77→**0.00 %** | ✅ |
| E7 | Reveal.js | stray text at (0,0); sr-only aria region painted | skip `clip: rect()` zero-area boxes; don't expand ≤1 px overflow clips; clip an element's *own* text by its own `overflow` | 3.2→2.68 % | ✅ |
| E8 | Reveal, KaTeX | webfonts missing | follow `@import`ed sheets for `@font-face`; serve bench pages over http | reveal 2.68→1.11 %, katex 0.85→0.19 % | ✅ |
| E9 | Reveal | slide text ~4 % too large | ancestor `scale()`: rects are post-transform, font-size/letter-spacing are not → multiply by the element's effective uniform scale | content diff 31.4→**4.5 %** | ✅ |
| E10 | Bootstrap tables | 26 cell rasters (23 % area) | sharp `inset` box-shadows (`0 0 0 9999px`) → evenodd vector ring; blurred insets still raster | raster nodes 31→6, text cov 73→97 % | ✅ |
| E11 | Bootstrap avatar | `rounded-circle` `<img>` drawn square | image paints in the content box, clipped by border-radius | visual fix | ✅ |
| E12 | Bootstrap, pypi, MUI | `<input>` always raster | single-line text inputs with author chrome → box + value/placeholder text (native-looking inset borders stay raster) | bootstrap raster area 23→9 % | ✅ |
| E13 | 17 new live sites | find the next problems | corpus expansion (Wikipedia, HN, MDN, react.dev, BBC, Apple, tailwindcss.com, Stripe, Vercel, Python docs, Bootstrap, antd, MUI, Vue, Guardian, Reddit, Amazon) | surfaced E14–E18; antd/Apple/Bootstrap sites were 80–100 % raster | 📋 baseline |
| E14 | react.dev, Apple, antd | whole nav/card subtree rastered because of `backdrop-filter` | no longer a subtree-raster reason (box vector, blur ignored) | small: react 67→63 % raster | ➖ necessary but not the main cause |
| E15 | Apple | hero headline missing (under its art) | **stacking contexts**: z-indexed descendants hoist to the nearest ancestor stacking context (neg → flow → pos) instead of sorting among siblings | Apple 1.21→**0.09 %**, text restored | ✅ |
| E16 | many | opaque orange/green boxes vanished | `transparent()` regex `/,\s*0\)$/` also matched `rgb(255, 153, 0)` (blue = 0) → alpha-0 only | HN 1.69→**0.00 %** (with E17/E18), fixture | ✅ latent core bug |
| E17 | fixtures, Bootstrap | `border-radius:50%` on a 160 px box drawn as 50 px-radius square | resolve % radii against the box | pass | ✅ |
| E18 | Apple, nodejs | `body::before{position:fixed}` scrim rastered the whole `<body>` (2 MP); body bg painted above negative-z layers | `tryPseudoBox` supports `position:fixed`; `<body>` bg propagates to the canvas when `<html>` has none | apple raster 100→0 % | ✅ |
| E19 | MUI, Bootstrap, react.dev, Stripe | top raster source = `background-image` (alpha scrims, radial, `to bottom right`, px stops, 2-layer) | shared stop parser: premultiplied-alpha resampling, px stops; corner keywords; `radial-gradient` (circle/ellipse, size keywords, `at`); multi-layer; `image, color` shorthand | bootstrap.com raster 97→1 %, MUI 31→2 % | ✅ |
| E20 | react.dev, Tailwind, Vercel | `conic-gradient` / `repeating-linear-gradient` raster (1.27 MP on react.dev) | repeating → `spreadMethod="repeat"` over one period; conic → 180 painter's-algorithm slices (each slice covers the rest of the turn, so every boundary is anti-aliased once; the first try with adjacent wedges produced moiré, the second with a wrong end angle painted one colour) | react.dev raster 63→**0 %** | ✅ |
| E21 | Stripe cards | `clip-path` rastered whole cards | `inset()/circle()/ellipse()/polygon()` → absolute-px `<clipPath>`; applied to every vector node the element produced (like `mask`) | stripe raster 56→32 %, text cov 35→84 % | ✅ |
| E22 | pypi, Stripe, Bootstrap | cross-origin `<img>` (no CORS) = screenshot placeholder | Node backend downloads `src` via the context request API and emits a real `<image>` (full res, object-fit kept) | pypi raster 2→0 % (SVG 0.9→2 MB: real image bytes); stripe 32→12 % | ✅ |
| E23 | Stripe | all body text in a fallback font — **zero** `@font-face` embedded | stylesheets on a CDN are opaque to `cssRules` and CORS-blocked for in-page `fetch`; Node backend fetches their text (request API) and passes it as `externalCss`; also carries `font-feature-settings`, `font-variation-settings`, `font-stretch`, `text-rendering` on the `<text>` | stripe 1.66→**0.72 %** | ✅ (regression test uses a CDN fixture with no CORS on CSS) |

| E24 | 32 new live sites | 36氪 33 %, IKEA 13.6 %, Shopify 48 %, Figma 11.6 % — conversion bugs or moving targets? | harness: freeze CSS animations, scroll once for lazy loading, bounded image-decode wait; a second screenshot of the *original* page after capture gives `drift` (page self-change); `unstable` (>2 % drift) is reported, not gated. CDP `Emulation.setVirtualTimePolicy: pause` was tried and **deadlocks Playwright screenshots** (all targets errored) | measured drift: IKEA 11 %, 36氪 9 %, Figma 14 % ⇒ most of those diffs are page motion (carousels, lazy content), not conversion error | ✅ method; 📋 re-baseline those targets as `unstable` |
| E25 | Bootstrap carets, tag arrows, Guardian lists, Carbon ad | `pseudo` was the 2nd-largest raster source (2.2 MP over the 32 new sites) | empty-content / `attr()` flow pseudos are materialized as a temporary `<span>` with the pseudo's computed style (as icon-font pseudos already were); only `url()` backgrounds and `counter()/quotes` stay raster | fixture `pseudo-flow` vector, <1 % | ✅ |
| E26 | same | CSS triangles (`border: .35em solid; border-left/right: transparent`) drawn as bars | `emitBorder`: mitered per-edge trapezoids, transparent edges skipped, rounded ring clip for radii | carets/tag arrows match | ✅ |
| E27 | Reveal, tailwind rotated card, Bootstrap | rotate/skew rastered the whole subtree | 2D `transform` → `<g transform>`: clear the transform, measure the untransformed subtree, re-apply as `matrix(T(o)·M·T(−o))`; per-layer outer clip; bail to raster if a screenshot is needed inside (canvas, video…) or the element animates | fixture `transform-2d`: vector, 2 %; **matrix numbers must keep 6 decimals** — 2-decimal rounding turned `rotate(-1deg)` into 1.15° (tailwind 0.34→0.09 %) | ✅ |
| E28 | tailwind progress bar | `rounded-full` (9999px) bar became a lens | SVG clamps `rx` and `ry` independently; clamp the radius to min(w,h)/2 before emitting; `roundedRectPath` now scales all radii like CSS | fixed | ✅ |
| E29 | fixtures | `border-radius: 50%` on non-square boxes is an ellipse | `radiiY` (vertical radii) on boxes, elliptical arcs in the path | pill/ellipse fixture | ✅ |
| E30 | 36氪, IKEA, Figma, Shopify (diffs 10–48 %) | moving targets or conversion bugs? | harness `drift` (second screenshot of the original page) + `unstable` status; pausing CDP virtual time **deadlocks** screenshots (rejected); bounded `img.decode()` (it hangs forever on never-loading images — made the whole bench stall); poll `img.complete` for lazy images (sspai captured a still-broken `<img>`) | drift IKEA 17 %, Figma 15 %, Shopify 43 %, NASA 10 %, 36氪 18 % → **page motion, not conversion error** | ✅ method |
| E31 | all | `validate()` passed `captureScrollableContent:true` (non-default) which widens `overflow:hidden` clips to scroll size | harness now uses the backend default (`FITH_SCROLLABLE=1` to opt in) | removes a fake "clipping" error class (AG Grid, clipped tilt) | ✅ |
| E32 | Linear, Svelte, Cloudflare, Next.js | `mask` was the #2 raster source (3.5 MP) | `parseMaskLayers`: radial/linear gradient layers (px/% stops, alpha → white+alpha), `mask-composite` add → one union `<mask>`, intersect → nested masks; accepts the legacy `-webkit-mask-composite` spellings (`source-in`/`source-over`) Chrome reports; lists of `border-box` origin/clip; `transparent` stop = alpha-0 (it was read as opaque) | next.js raster 42→**0 %**, cloudflare 94→47 %, linear 137→59 %; fixture `mask-layers` | ✅ (`exclude`/`subtract`, sized/clipped layers → still raster: antd border-beam) |
| E33 | echarts, Chart.js, Vercel, Docker, zhihu QR | every `<canvas>` was a screenshot (2.3 MP) | readable 2D canvas → `toDataURL` → `<image>` in the content box (borders vector); a blank read-back (WebGL without preserveDrawingBuffer) or tainted canvas falls back to raster | echarts/chartjs/vercel/docker raster **→ 0 %** | ✅ |
| E34 | GitHub Docs, MS Learn, Spotify, Airbnb, tailwindcss.com | `background-image` was the #3 raster source: sized/tiled layers, `url()` + gradient mixes, `image-set()`, 4-value positions, `content-box` clip, `fixed` attachment, `in srgb` | general background engine: each layer → tile rect + repeat flags + clip box (own radii) → SVG `<pattern>` (gradients expressed in tile-local space, conic as slices, images as `<image>`); `calc(100% − Npx)` positions; fixed = viewport-positioned; the gradient fast path now requires default origin/clip/attachment (it silently ignored `content-box` before); `linear-gradient(in srgb,…)` accepted, other colour spaces stay raster | githubdocs 23→**0 %**, mslearn 13→**0 %**, spotify 13→1 %, airbnb 16→1 %, tailwindcss 26→12 % | ✅ (space/round repeat, non-sRGB interpolation → raster) |
| E35 | Linear grain, Stripe hero title, Svelte, antd | `blend-mode` (1.1 MP) and subtree `filter` (0.7 MP) rastered whole subtrees | **node groups**: `Scene.groups` + `NodeBase.groups`; the emitter wraps consecutive member nodes in ONE `<g filter=… style="mix-blend-mode:…">` (per-node filter/blend is wrong for overlapping children). CSS filter functions → one `<filter>` chain (`feColorMatrix` grayscale/sepia/saturate/hue-rotate, `feComponentTransfer` brightness/contrast/invert/opacity, `feDropShadow`, `feGaussianBlur`, sRGB); screenshots inside a group are not re-filtered | lab fixture `filter-blend-groups` vector, <3 %; stripe/linear raster → **0 %**; two existing tests used `filter` as their "needs raster" example → moved to 3D transforms | ✅ (`url(#…)` filters, 3D remain raster) |
| E36 | Linear | headline 4 % too wide — **no `@font-face` embedded**: 50+ opaque CDN sheets, only the first 16 were fetched | fetch up to 120 sheets, 8 concurrently, record font-less ones as empty so the page doesn't re-fetch | linear 3.56→**0.40 %** | ✅ |
| E37 | antd.design | `matrix3d(…,0,0,1000,1)` (= `translateZ`) rastered a 1280×640 subtree | a 3D matrix is only a 3D effect under perspective (own `perspective()` term or a perspective ancestor); otherwise it is an orthographic projection and the (a,b,c,d,e,f) part is exact | antd raster 80→40 %, text cov 60→101 % (fixture `transform-3d-flat`) | ✅ |
| E38 | antd inputs | `text-overflow: ellipsis` text inputs excluded from vector inputs | truncate the value with the browser's prefix-that-fits + `…` | form-control rasters gone on antd | ✅ |
| E39 | Bootstrap accordion, Wikipedia, Mozilla | pseudo `::after` with `url()` background (chevrons/icons) stayed raster | pre-load pseudo background images in `walkNode`, then `materializePseudo` can place them | bootstrap lib raster 9→1 %, wikipedia 12→2 %, mozilla 34→**0 %** | ✅ |

### Negative / neutral results
- **Flagged "regress" in `pseudo-url-3d-flat`** (bbc 0.00→0.22 %, antdesign 0.07→0.35 %, devto 0.37→0.61 %): their raster
  area fell (antd 80→40 %); the previous baselines were screenshots, the new numbers are vector rendering. Re-baselined. (kept so they are not retried blindly)
- **E14 (backdrop-filter vectorize)** barely moved raster area: the large rasters were `background-image` and
  `pseudo` on *ancestors*; backdrop-filter was only the first thing the triage printed.
- **BBC 4.8 % / 23.7 % spikes** were page drift, not regressions — fixed by `--repeat` + median, not by code.
- **Stripe diff went 0.34→1.23→0.72 % while quality *improved*:** the 0.34 % baseline was a screenshot of the card; vector text/images have
  anti-aliasing differences and the page has a live counter ("Global GDP …"). Compare *raster area* and text cov first.
- **Gradient vectorization changed an existing test** (`extension-viewport` used a radial gradient as its "must
  raster" example); switched it to `conic-gradient`, which is still raster — an intended improvement, not a regression.

## Effects lab (SVG technique research)
`pnpm bench:effects` renders CSS vs candidate-SVG for 14 effects and diffs them; results and the full CSS→SVG catalog are in
[svg-effects.md](svg-effects.md). First run: filter functions via `feColorMatrix`/`feComponentTransfer` **0.00 %**, `mix-blend-mode`
in SVG **0.00 %**, 2D `skew` **0.00 %**, blurred inset shadow **0.00 %**, `backdrop-filter` emulated by a blurred clipped re-emit of the
content below **0.21 %**, `rotate` group 0.77 %. These are proven techniques not yet wired into capture; the largest real-site wins
are expected from (1) 2D transforms as `<g transform>`, (2) `filter`/blend on subtrees, (3) backdrop blur emulation, (4) blurred inset shadows.
Items SVG truly cannot match are recorded at the end of that file.

## Open problems (ranked by raster area / impact on the corpus)
| problem | seen on | notes |
|---|---|---|
| tiled gradient layers (`background-size` ≠ auto) | tailwindcss.com hatch pattern | needs `<pattern>` |
| `mix-blend-mode` | Stripe hero title | needs backdrop; keep raster unless text over solid bg |
| `mask` via `mask-image` on containers | antd.design border beam (0.8 MP) | existing linear-mask path only |
| `transform-3d` | antd.design | flatten when perspective is trivial |
| `::before/::after` non-absolute (flow) pseudos | Guardian lists, Carbon ad | `materializePseudo` for box-only pseudos |
| `<iframe>`, `<canvas>`, `<video>` | MDN, BBC, Guardian, Vercel | inherently raster |
| paint order of z-auto positioned pseudo vs flow | stacking-order fixture (0.5 %) | positioned pseudos paint with positioned layer |
| border widths / radii under ancestor `scale()` | Reveal | only text is scaled today |
| FullCalendar multi-day bar under grid lines | fullcalendar | positioned/z-order of event layer |
