# Development backlog

This inventory covers the current source, design, regression coverage, and observed
example differences. It is not a claim that all browser/CSS behavior has been
enumerated. A hypothesis becomes implementation work only after reproduction.

## Delivery and branch stack

- Base: `main`.
- First layer: `fix/svg-fidelity-regressions`, six commits through `d4459ea`;
  pushed, with library/extension builds and 60 default tests passing.
- Second layer: `fix/nested-text-backgrounds`, based on the first layer.
  Its nested-text and SVG-visibility fixes passed library/extension builds and
  62 default tests (9 optional skipped). Its PR should target `fix/svg-fidelity-regressions` until the first PR merges,
  then be rebased onto `main`. Do not combine both layers in a second main-targeted PR.
- Git operations work. GitHub API CONNECT requests currently return proxy 403;
  PR creation is blocked by network policy. API connectivity must be restored
  before diagnosing whether API authentication is also missing.

## Completed first-layer work

| Item | Evidence |
| --- | --- |
| Invisible/partially transparent pseudo-elements | Visual fixture and complete suite |
| WebKit fill color; gradient and solid backgrounds clipped to text | Failing-first fixtures and complete suite |
| Multiline gradient positioning and CSS background origin | Fixture improved from 0.490% to 0% |
| Root inline SVG opacity applied twice | Failing-first fixture, descendant opacity retained |
| Reference screenshots taken mid-viewport transition | Dedicated 2-second transition fixture |
| MUI frozen lockfile installation | Only the missing tree-view resolution added; frozen reinstall passed |

## Prioritized remaining work

P1: content loss or incorrect paint; P2: fidelity/coverage; P3: broader capability
or operational improvements. Priorities are provisional until measured.

| Priority | Candidate | Status/evidence | Next useful check |
| --- | --- | --- | --- |
| P1 | Ancestor-clipped backgrounds on nested text | Fixed in `4601db7`: fixture improved from 1.591% to 0.0054%; 61 tests passed | Preserve regression coverage |
| P1 | Parent opacity with overlapping descendants | Hypothesis: opacity is multiplied per paint node rather than composited as a group | Overlapping opaque children under a translucent parent |
| P1 | Inline SVG stylesheet visibility and transforms | Visibility fixed in `a verified second-layer commit`: hidden paths and visible overrides preserved; 62 tests passed. CSS transforms remain a hypothesis | Isolate transformed groups |
| P1 | Stacking contexts across cousins | Hypothesis: child ordering approximates CSS stacking without context flattening | Positioned descendants under opacity/transform/isolation parents |
| P1 | Raster fallback and vector children double-paint | Known architectural limitation; extension disables container fallback | Compare Node/library/extension behavior with translucent children |
| P2 | Background size and position on text-clipped gradients | Not covered by positioning-area fix | Explicit size, position, repetition, and multiple background layers |
| P2 | Ancestor backgrounds with nested backgrounds and opacity | Single nearest clipped background supported; compositing unverified | Nested clipped backgrounds, contrasting alpha, and background overrides |
| P2 | Outline-mode gradient text | Emitter retains text for gradient-filled nodes | Define intended outline guarantee and test font-independent gradient paths |
| P2 | WOFF2 outline fonts | Observed environment limitation; local TTF setup resolves defaults | A controlled WOFF2 font-face fixture and supported parser capability |
| P2 | Unicode and complex text shaping | Coverage gap in character-range bucketing | Combining marks, emoji sequences, bidi, ligatures, and preserved whitespace |
| P2 | Text baseline, decorations, truncation | Approximation/coverage gap | Mixed fallback fonts, vertical alignment, underline offset, multiline ellipsis |
| P2 | SVG identifiers and external references | Coverage gap with cloned/duplicated SVGs | Multiple icons reusing defs IDs, masks/filters, external image/font references |
| P2 | Rounded per-side borders, outlines, and shadows | Emitter approximates unequal borders | Unequal border widths/colors on rounded corners; inset/negative spread cases |
| P2 | Scroll and viewport semantics across backends | Existing backend option differences documented in CLAUDE.md | Same fixture through Node, in-page, and viewport capture; nested scrollers |
| P2 | MUI chart and form differences | Example passed at 0.760%, with localized residual diff | Isolate chart strokes, form notched outlines, avatars, and metrics |
| P2 | Production Node pipeline versus validation harness | Different capture flags are documented | Repeat representative fixtures through public API and CLI |
| P2 | Animation determinism outside reference screenshots | Reference now settles finite animations; other timing is unverified | Animated charts, infinite animations, and raster/scene consistency |
| P3 | Required example checks in CI | Root CI covers fixtures; examples currently validated manually | Cost/build-time assessment before adding example jobs |
| P3 | Full extension E2E | Optional suite not run in headless-shell environment | Obtain supported extension-capable Chromium, preserve permission behavior |
| P3 | Live website regression | Optional network-dependent suite not run | Restrict to stable targets and isolate network/content variation |
| P3 | Performance and output size | No measured regression established | Profile representative pages before optimizing DOM/style queries or SVG deduplication |
| P3 | Reusable environment instructions | Prepared; keep counts and additional example dependencies accurate | Refresh saved startup/install instructions after validated changes |

## Work loop

1. Pick the highest-value reproducible item; create a small fixture first.
2. Confirm the existing implementation fails and identify the paint/layout cause.
3. Correct shared core behavior without backend-specific duplication.
4. Run library and extension builds plus the entire default suite. Run affected
   example/public-API checks when justified. Keep skipped optional suites distinct.
5. Commit separately, update this inventory, push the stack branch, and create or
   update the corresponding PR once API access is available.

Do not relax thresholds, silently disable assertions, or treat successful SVG text
serialization as proof that the text is visible. Preserve the pinned toolchain and
lockfiles except for diagnosed dependency reconciliation.
