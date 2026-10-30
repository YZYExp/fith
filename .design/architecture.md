# fith 架构

状态：**已实施**（描述 main 在 2026-10-30 的结构；拆库过程与取舍见 `library-split.md`，字体见 `fonts.md`）。「未决」一节单独列出还没做或没定的部分。依据是对源码的阅读和本地 `pnpm build`、`pnpm test`（162 通过、9 跳过），行数为当时的静态统计。

## 1. 它做什么

把一个已渲染的 HTML 页面或其中一个元素，转成自包含的、向量优先的 SVG。文字保持 `<text>`（可选转成路径），盒子、边框、渐变、阴影、裁剪都用 SVG 原语；SVG 画不出的才局部栅格化。布局不自己算，全部读浏览器已经算好的结果（`getComputedStyle`、`getBoundingClientRect`、`Range.getClientRects`），所以与 Chrome 的盒模型、折行、字体度量一致。

## 2. 两段式管线

```
 页面（任一环境）                          任意环境（纯函数）
 ┌──────────────────────────┐   Scene    ┌───────────────────┐
 │ captureScene(opts, root?)│ ─────────▶ │ emitSvg(scene,opts)│ ──▶ SVG 字符串
 └──────────────────────────┘  (JSON)    └───────────────────┘
        读 DOM / CSSOM                         │ buildReport(scene) ──▶ CaptureReport
```

- **捕获**（`src/core/capture/`）只用标准 DOM API，在页面里跑，输出 `Scene`：按绘制顺序排好的 `PaintNode[]`，坐标是绝对的 CSS px，样式值是浏览器算好的值。
- **发射**（`src/core/emit/`）把 `Scene` 序列化成 SVG，是纯函数，不碰 DOM，Node 和浏览器都能跑。
- **`Scene` 是两段的唯一边界**（`src/core/ir/types.ts`）。往 `Scene` 加字段，先加在这里。它是普通 JSON，所以能从页面传回 Node。

捕获与发射分开的原因：同一套捕获要在 Node（无头 Chromium）、浏览器页内库、MV3 扩展三处复用，而只有发射需要在没有页面的地方跑，也只有发射需要 opentype.js。

## 3. 源码布局与依赖方向

```
src/
  core/
    ir/types.ts        Scene、PaintNode 各类、CaptureOptions、FontFace/FontRequest/FontResolver、CaptureReport
    capture/           读 DOM（见 §4）
    emit/              Scene → SVG（见 §5）
    report.ts          buildReport：哪些区域是栅格、哪些被省略、字体怎么带
    backend.ts         CaptureBackend 能力契约
  css/                 纯 CSS 解析：color、gradient、shadow、filter、transform、clip、util（字符串进、数据出，无 DOM）
  inject/entry.ts      Node 后端注入页面的包的入口（esbuild 打成 IIFE，产物 bundle.generated.ts 不入库）
  backends/
    node/              Playwright 后端、CLI、fontconfig 字体、跨域图、diff-patch
    browser/           页内库、dom-raster、viewport-raster
    extension/         MV3：background、content、popup、viewer、shot-scheduler
  index.ts node.ts outline.ts   包的公开入口
```

依赖方向：`ir ← css ← capture ← backends`；`emit` 只依赖 `ir`（outline 另依赖 opentype.js）。`css/` 里没有 DOM，`captureScene` 用到页面的颜色规范化器（它靠 canvas）时，由调用方传一个 `ColorNorm`。

## 4. 捕获（`core/capture/`）

`capture.ts`（约 160 行）只做准备：确定要读的 `doc`/`win`、根元素与是否子树、画布尺寸和原点，建一个 `CaptureCtx`，调 `walk`，等图片任务，收字体，组装 `Scene`。其余全是兄弟模块里「第一个参数是 `ctx`」的函数：

| 模块 | 职责 |
|---|---|
| `ctx.ts` | `CaptureCtx`：文档与窗口、选项、`nodes`、计数器与缓存、已绑定的 CSS 解析器。一次捕获的状态都在这里 |
| `walk.ts` | 遍历、层叠上下文与提升（hoist）、`filter`/`mix-blend-mode` 的分组、2D 旋转倾斜（清掉 transform 量好再套 `<g transform>`）、遮罩 |
| `elements.ts` | 可见性、哪些要整体栅格化（3D、`filter` 子树等）、内联 SVG、图片、canvas、`pushRaster` |
| `box.ts` | 背景、边框、阴影、`::before`/`::after`（含把伪元素临时实体化） |
| `text.ts` | 文本折行、输入框、列表标记、原生控件（checkbox、select、textarea） |
| `background.ts` | 盒子几何（圆角、裁剪求交）、渐变层、mask 层、背景图层 |
| `fonts.ts` | `@font-face` 收集（含 `@media`/`@supports`/`@layer`/`@import`、跨域样式表）、按使用的字符向宿主要字体 |
| `images.ts` | 图片与 canvas 转 data URL（用元素自己的 window 去 fetch） |
| `unfurl.ts` | 滚动容器展开与内容可见性重置，每个都返回幂等的 `restore`，`finally` 里一定调用 |
| `colorNorm.ts` | 用 canvas 把任意 CSS 颜色规范成 `rgb()/rgba()` |
| `source-html.ts` | 另一个入口：把页面或元素序列化成独立的 `.source.html`（反馈用，默认关） |

### 约束（每条都对应过真实缺陷）

- **读元素自己的文档**：用 `root.ownerDocument` 与它的 `defaultView`，不读页面全局，所以编辑器能捕获同源 iframe 里的元素（跨 realm 时 `instanceof HTMLElement` 是 false，新代码用 `win.HTMLElement`）。`dom-raster.ts` 同理。
- **状态只在 `CaptureCtx`**：不要用模块级变量，两次捕获可能同时在不同文档里跑。
- **注入是一个包，不是序列化函数**：Node 后端用 esbuild 打的 IIFE 一次性注入，所以页内代码可以 import 模块；但要保持无 Node API。凡在页面里执行 `captureScene` 的测试和脚本都用 `runCaptureScene`，不要 `page.evaluate(captureScene)`。从 `.ts` 源码运行时即时打包，不用可能过期的 `bundle.generated.ts`。
- **子树（元素）导出**：祖先只提供上下文，不按自己的盒子裁剪，也不让它们的 `overflow` 裁掉根；根内纵向滚动容器默认展开到完整高度。
- **矢量优先，栅格是最后手段**：能矢量表达的（线性渐变 mask、`url()` 单层背景、图标字体的伪元素）一律矢量；无法精确复现的（多层、平铺、自定义 origin/clip）才栅格。栅格节点的截图已含其效果，不要再对它套一次 filter。
- **坐标**：`pushRaster` 用视口/页面 px，不是相对子树。`viewBox` 的原点（`originX/Y`）处理子树偏移。

## 5. 发射（`core/emit/`）

- `svg.ts`：`emitSvg(scene, { idPrefix, outline })`。按 `nodes` 顺序输出；连续共享同一外层分组的节点包进同一个 `<g>`（filter、混合模式作用于合成后的子树）；重复的图标走 `<defs>`+`<use>`；有 `baseLayer` 时先画整页截图再画矢量。
- `defs.ts`：`Defs` 收集并去重 clipPath、filter、渐变、mask、pattern 的 id；`idPrefix` 让多张 SVG 合进同一文档不冲突（内联 SVG 里自带的 id 及其 `url(#…)`、`href`、`xlink:href` 引用也一并改写）。
- `primitives.ts`：数字格式、转义、圆角路径（半径按 CSS 规则整体缩放，不会输出超大 `rx`）。
- `outline.ts`：`createOutliner(fonts, systemFont?, fallback?)` 用 opentype.js 把字形转成不带 hinting 的路径；只在 `fontMode: 'outline'` 时加载。
- `report.ts`：`buildReport(scene)` 汇总栅格节点（原因、位置、谁填的像素：`screenshot`/`dom`/`none`）、被省略的区域、每个字体族是 `embedded`/`outlined`/`referenced`。

## 6. 后端

### Node/Playwright（`backends/node/`，入口 `fitting-html/node`）
`renderDetailed(input, opts)` 开页面（`html`/`url`/已有 `page`），注入捕获包，跑 `captureScene`，然后在 Node 侧补齐 `Scene`：
1. 字体：`fonts` 是列表就随选项进页面；是 `FontResolver` 就在 Node 侧按 `fontRequests` 逐个问；outline 模式用 fontconfig 找系统字体（`fonts.ts`，只接受度量兼容的替代，其余视为未安装）。
2. 跨域 `<img>`：下载真实字节嵌入，比截图更清晰（`cors-images.ts`）。
3. 栅格目标：对每个 `rasterTarget` 截图（`screenshotRasterTargets`）。
4. 可选：`guaranteeFloor`（整页截图作底层）、`diffPatch`（把 SVG 渲染回 Chromium，与原页做格子对比，用截图补不一致的区域，`diff-patch.ts`）。
5. `emitSvg`，并返回 `report`；`captureSourceHtml` 开启时附 `.source.html`。
还有 CLI（`fitting-html` 命令）。

### 浏览器页内库（`backends/browser/`，入口 `fitting-html/browser`）
`captureElement` / `captureCurrentPage`（带 `Detailed` 后缀的版本同时返回 `report`）直接在页面里调用 `captureScene` 与 `emitSvg`，没有 Node、Playwright、CDP。没有截图能力，所以栅格有三层：宿主给的 `rasterize(rect, scale, {element, reason})`（抛错只让那一块变成空，不拖垮整个捕获），然后是库自带的 `dom-raster.ts`（克隆元素、内联计算样式、放进 `<foreignObject>`、画到 canvas；做不到就返回 null 而不是错图），再往后才是省略并写进 `report`。`fonts` 与 `idPrefix` 同样可由宿主给。

### Chrome 扩展（`backends/extension/`）
MV3：content script 捕获，background 提供截图（`captureVisibleTab` 经 `shot-scheduler` 限速重试；"Full page" 范围可用 `chrome.debugger` 的 `captureBeyondViewport`）。**扩展从不滚动页面**（滚动会触发 sticky/fixed、懒加载和滚动动画）。`containerRasterFallback` 对扩展恒为 false（容器截图含子元素，再矢量化子元素会重影）。打包产物里不能出现 Unicode 非字符，由 `extension-bundle.test.ts` 把关。

## 7. 对外入口与依赖

| 入口 | 内容 | 依赖 |
|---|---|---|
| `fitting-html` | `emitSvg`、`buildReport`、IR 类型 | 无 |
| `fitting-html/node` | `renderToSvg`、`renderDetailed`、`htmlToSvg` | 可选 peer `playwright`（outline 另需 `opentype.js`） |
| `fitting-html/browser` | `captureElement`、`captureCurrentPage` 及其 `Detailed` 版本 | 无 |
| `fitting-html/outline` | `createOutliner` | 可选 peer `opentype.js` |

Playwright 与 opentype.js 只在对应路径上动态 `import()`，主入口和浏览器入口的产物里没有它们（`test/exports.test.ts` 检查）。`pixelmatch`、`pngjs` 是普通依赖（diff-patch 与验证用）。包名与命令目前仍是 `fitting-html`，等待迁移到 `0x0079/fith` 后再统一。

## 8. 测试与基线

- **单元**：`css.test.ts`（纯解析）、`emit.test.ts`（发射器）、`viewport-raster`、`shot-scheduler`、`exports.test.ts`（各入口的依赖面）。
- **视觉**（`test/visual/`）：每个捕获行为配一个 `test/fixtures/` 里的页面，既做像素差（`scripts/validate.ts`：在第二个 Chromium 页里渲染 SVG 与原页对比），也做结构断言（"这段文字仍是矢量"、"没有 `data:image/png`"），防止悄悄退化成栅格。比较用的 Chromium 固定关掉 hinting 和 LCD 文字，因为转成路径的字形本来就没有，否则结果会随机器的 fontconfig 变。
- **跨文档**：`cross-document.test.ts` 覆盖元素在同源 iframe 里的捕获和 DOM 栅格。
- **门控套件**：`extension-e2e`（需要完整 Chromium，设 `EXTENSION_E2E=1`）、`realworld`（线上站点，`REALWORLD_TESTS=1`）。
- **真实世界基准**（`bench/`）：`pnpm bench` 在线上站点和 npm 取来的第三方 UI 库上跑，报告像素差、内容差、最差分块、矢量文字覆盖率、栅格面积，对照 `bench/baseline.json`。回归先定位，再在 `realworld-regressions.test.ts` 里用固件钉住，再改基线。
- **黄金快照**：`pnpm golden <dir>` 输出全部固件的 SVG，重构前后 `diff -r` 要逐字节一致。
- CI：构建、扩展打包、全量测试；扩展 E2E 只在 push 上跑。

## 9. 捕获规则速查（来自真实回归）

透明色判断看 alpha 而不是字符串后缀；圆角 `%` 按盒子解算并保留纵向半径；transform 矩阵保留 6 位小数；层叠上下文里的 z-index 子孙属于最近的层叠上下文而不是父级；`<html>` 无背景时 `<body>` 背景传播到画布；`filter`/混合模式按子树作为整体分组；`@font-face` 的 `url()` 相对样式表解析，且 `font-feature-settings`/`font-variation-settings`/`font-stretch` 要带到 `<text>`；渐变快速路径只适用于默认 origin/clip/attachment，其余走分层引擎。细节与例子见仓库根目录 `CLAUDE.md`。

## 10. 未决

- 保真缺口（`docs/development-backlog.md`）：父级透明度对重叠子节点的整体合成、栅格与矢量子节点重复绘制、复杂文字整形。
- 包名与仓库名统一、首个发布版本与 CHANGELOG（`library-split.md` 阶段 F）。
- Tingly Design 一侧的适配层（`@dc/svg` 与各类型的 SVG 导出菜单项）还没做，等 YZ 通知开始；接入前不改变本库的公开面。
- `captureScene` 仍直接读若干 `(opts as any)` 选项（`captureScrollableContent`、`containerRasterFallback`、`unfurlScrollContainers`），应进 `CaptureOptions` 类型。
