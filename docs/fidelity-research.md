# Fidelity research and regression coverage

Use the same Chromium to render the original page and the standalone generated
SVG. Compare with the existing pixelmatch threshold of 0.1. Load the SVG as a file;
embedding it in an HTML document introduces default body margins. Finish viewport
transitions before taking the reference screenshot so capture and reference use
the same layout.

## Confirmed and fixed

| Problem | Regression fixture | Validation |
| --- | --- | --- |
| Invisible pseudo overlays obscure captured text; partial opacity is lost | `pseudo-visibility.html` | Pixel comparison includes opacity 0, hidden, absent, and partially transparent overlays |
| WebKit text fill overrides CSS color; text-clipped backgrounds paint whole rectangles | `text-fill.html` | Gradient and solid backgrounds clipped to text, with borders retained |
| Full-page viewport resize captures a sidebar mid-transition | `viewport-transition.html` | A 2-second height transition settles before geometry capture |
| Text gradients use first-line bounds instead of the background positioning area | `text-gradient-geometry.html` | Padded, bordered, multiline text with padding-box and content-box origins; fixture difference fell from 0.490% to 0% |
| Inline SVG root opacity is applied in both cloned markup and Scene wrapper | `svg-opacity.html` | CSS-class and inline-style root opacity, descendant opacity, and repeated icon deduplication |

The Ant Design example measured 1.055% before these renderer and measurement
corrections and 0.046% after the first fixes. The improvement includes eliminating
an animation timing mismatch; it is not solely a renderer accuracy improvement.
These numbers depend on browser and installed fonts and are not portable golden
baselines. Do not increase thresholds to accommodate regressions.

The MUI example also requires `@mui/x-tree-view` in its lockfile. Frozen installation
now succeeds without updating unrelated locked dependencies.

## Reproduction

Use the repository-pinned pnpm version and install Chromium as documented in the
README. In restricted environments the existing scripts accept `CHROMIUM_PATH`
or use the npm-distributed `@sparticuz/chromium`. Extract that browser once before
parallel tests to avoid concurrent extraction races.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm build:extension
pnpm test --maxWorkers=4 --minWorkers=1
(cd examples/antd-app && pnpm install --frozen-lockfile)
(cd examples/mui-app && pnpm install --frozen-lockfile)
pnpm validate:example antd-app 1280
pnpm validate:example mui-app 1280
```

Visual artifacts are written to the ignored `test/visual/__out__/` directory.
Live websites and full extension E2E remain separately gated tests.

## Next investigations

These are hypotheses and coverage gaps, not established defects:

1. Text clipped against an ancestor's background when nested spans override font
   styles. Reproduce before deciding how background context should propagate.
2. Explicit background size, position, repeat, and multiple layers for clipped
   text. Current gradient positioning assumes the background fills its origin box.
3. SVG styles outside the copied presentation properties, especially CSS transforms
   and stylesheet-driven visibility. Test CSS and SVG attributes independently.
4. MUI chart and form-control differences. Separate animation, raster fallback,
   text metrics, and actual paint defects using isolated fixtures.

For each investigation: reproduce with a failing fixture, make the smallest
supported correction, run the build and complete default suite, then commit the
change separately. Keep optional external tests distinct from local regression
results.
