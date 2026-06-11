# fitting-html 设计规划

> 目标：把任意 HTML（含 CSS）**像素级忠实地**转换为一份**纯 SVG**。
> 技术栈：TypeScript；布局计算复用浏览器引擎。
> **核心架构约束**：捕获逻辑用纯 DOM API 实现，与运行环境解耦——同一套核心既能在 Node（headless Chrome）跑，也能作为浏览器插件 / 页内库跑（见 §1.4、§3）。

---

## 1. 目标与范围

### 1.1 核心目标
- **完全拟合（pixel-fidelity）**：生成的 SVG 在标准 SVG 渲染器中显示，应与 Chrome 渲染原 HTML 的结果在视觉上一致。验收以像素差异阈值衡量（见 §10）。
- **纯 SVG**：输出单个自包含 `.svg` 文件，不依赖外部资源——字体、图片、栅格回退全部内联（base64 / `<path>` / 内嵌 `<image>`）。
- **向量优先**：能用向量表达的（盒子、文本、边框、渐变、阴影）一律输出向量；只有 SVG 无法忠实表达的特性才局部栅格化回退（见 §6）。

### 1.2 非目标（首版不做）
- 交互性（JS 事件、`:hover`、动画时间线）。输出的是**某一时刻的静态快照**。
- 视频 / `<iframe>` 跨源内容的逐帧还原（仅取首帧或占位栅格）。
- 重排响应式：转换针对一个给定视口尺寸；不同视口需分别转换。

### 1.3 为什么复用浏览器引擎
"完全拟合" 要求和浏览器的盒模型、Flex/Grid、文本断行、字体度量、层叠顺序完全一致。自研排版引擎等于重造浏览器，工作量与误差都不可接受。复用浏览器已经算好的布局，我们只负责**把渲染结果翻译成 SVG**。

### 1.4 多运行环境：捕获层必须解耦（关键设计）
本项目要面向多个落地形态，最重要的是**未来作为浏览器插件**：

| 形态 | 代码运行位置 | 能用的能力 |
|---|---|---|
| Node CLI / 服务端 | Node 进程驱动外部 Chromium | Puppeteer/Playwright、CDP、截图 |
| **浏览器插件** | content script，**运行在页面内** | 直接 DOM/CSSOM、`fetch`；**无 Puppeteer/无 CDP** |
| 页内库 | 任意页面里被 `import` | 直接 DOM/CSSOM；无截图能力 |

关键结论：**Puppeteer 和 Playwright 都跑不进浏览器插件**——它们是 Node 自动化驱动，控制的是「外部」浏览器。如果把捕获写死在 CDP `DOMSnapshot` 上，插件形态将无法复用任何代码。

因此架构上**第一原则**：把"捕获"实现为**只用标准 DOM API 的页内脚本**（`getComputedStyle` / `getBoundingClientRect` / `Range.getClientRects`），它直接产出 Scene IR。

- **Node 后端**：用 Playwright **或** Puppeteer（二选一，封在后端里）启动 Chromium，把同一份页内脚本 `page.evaluate` 注入执行，并提供截图能力。
- **插件后端**：把同一份脚本作为 content script 运行；截图走 `chrome.tabs.captureVisibleTab`。
- **页内库后端**：在当前页直接运行；无截图能力 → `fallback:'none'`。

> **Playwright vs Puppeteer**：对"加载页面+快照"这件事二者几乎等价（都驱动 Chromium、都能开原始 CDP）。**默认用 Playwright**（团队更熟、auto-wait 稳、多浏览器可扩展）；Puppeteer 作为同接口的可选替代。封在 Node 后端接口后，换实现只动一个文件，不是承重决策。

**代价**：CDP `DOMSnapshot` 本来免费给出 Chrome 的精确 paint order；改走页内后，需要**自己实现层叠上下文的绘制排序**（CSS 已规范的算法，繁琐但确定）。好处是捕获只有一套、各环境行为完全一致；且 Node 测试里可用 CDP `paintOrders` 作为**校验基准（oracle）**，验证我们的排序算法与 Chrome 一致（见 §10）。

---

## 2. 核心原理

```
                         ┌──────────────── 环境后端（薄壳，可替换）────────────────┐
   HTML / URL / 现有页面 │  Node: Playwright|Puppeteer 启动 Chromium 并注入脚本     │
                         │  插件: content script 直接运行；页内库: 当前页运行       │
                         └───────────────────────────┬─────────────────────────────┘
                                                      │ 注入/直接运行
                                                      ▼
                         ┌─────────── 页内捕获脚本（纯 DOM API，跨环境共用）──────────┐
                         │ getComputedStyle · getBoundingClientRect ·                 │
                         │ Range.getClientRects · 自实现层叠上下文 paint order        │
                         └───────────────────────────┬─────────────────────────────┘
                                                      ▼
                                          Scene IR（中间表示）
                          扁平、按绘制顺序、绝对像素坐标、样式为计算值
                                                      │
                            ┌─────────────────────────┼──────────────────────────┐
                            ▼                          ▼                          ▼
                       向量发射器                 资源内联器                 栅格回退引擎
                   (rect/text/path)            (字体/图片)        (后端提供截图能力时；否则跳过)
                            └─────────────────────────┼──────────────────────────┘
                                                      ▼
                                                 纯 SVG 文档
```

关键点：**捕获脚本只依赖标准 DOM API**，因此一份代码在 Node（注入）、插件（content script）、页内库三种环境完全一致。绘制顺序由我们自实现的层叠上下文算法给出（Node 测试用 CDP `paintOrders` 校验）。栅格回退是**由后端注入的能力**——有截图能力（Node/插件）才启用，纯页内库无此能力则降级为 `fallback:'none'`。

---

## 3. 架构与模块

分层铁律：**`core/` 必须是纯 TypeScript，零 Node 依赖、零 Puppeteer/Playwright 引用**，这样才能整体打包进浏览器插件。环境差异全部隔离在 `backends/`。

实际落地结构（与早期规划的差异见下方说明）：

```
src/
  core/         ★ 纯 TS，跨环境共用，可 bundle 进插件（禁止 import 任何 node/playwright/puppeteer）
    capture/
      capture.ts        页内捕获：单个完全自包含的函数（DOM walk、paint order、
                        文本行盒、渐变解析、裁剪栈、@font-face 收集、回退判定全在其内）
    ir/
      types.ts          Scene / PaintNode / 样式结构（纯类型）
    emit/         SVG 发射器：IR → SVG 字符串
      svg.ts            主入口：骨架、viewBox、按 IR 顺序发射
      primitives.ts     盒子 / 边框 / 文本 / 图片等基元
      defs.ts           clipPath / 渐变 / filter / 内联 SVG 图标的 defs 管理与去重
      outline.ts        opentype.js 字形轮廓化（Outliner，浏览器/Node 通用）
    backend.ts        ★ CaptureBackend 接口（run 注入执行 + 可选 rasterize 截图能力）

  backends/     ★ 环境适配（各自只在对应形态打包）
    node/
      playwright.ts     启动 Chromium、page.evaluate 注入捕获、截图回退
      fonts.ts          系统字体解析（fontconfig）供 outline 模式
      diff-patch.ts     diffPatch 选项：渲染回 Chromium 比对并打栅格补丁
      cli.ts            命令行入口（bin: fitting-html）
    browser/
      index.ts          页内库：当前页直接运行 core；rasterize/outline 为可注入选项
      viewport-raster.ts 共享的非滚动 createViewportRasterizer（页内 + 扩展共用）
      raster-types.ts
    extension/          MV3：manifest.json + popup + content script + service worker
      content.ts        运行 core 捕获，经消息向 background 要截图
      background.ts     captureVisibleTab / chrome.debugger 截图、下载、菜单/快捷键
      shot-scheduler.ts 截图限速与重试调度（纯逻辑，单测覆盖）
      messages.ts / popup.ts / viewer.ts

  index.ts      ★ 默认导出 = core + node 后端（npm 主入口）
test/           布局见 CLAUDE.md（单元 + 视觉回归 + 门控 E2E）
```

与规划的主要偏差：
- **捕获没有拆成多文件**：`captureScene` 经 `.toString()` 序列化后 `page.evaluate` 注入，
  必须零 import、零闭包外引用，所有 helper 都定义在函数体内 —— 这是硬约束，不是偷懒。
- **未做 `puppeteer.ts` 备选后端**（Playwright 足够，没有需求驱动）。
- **paint-order oracle 测试未单独成目录**：排序正确性由视觉回归（逐像素 diff）间接钉死。

后端接口（概念）：core 不关心是谁、怎么提供环境能力，只面向接口编程。

```ts
interface CaptureBackend {
  /** 让捕获脚本在目标页面上下文执行并返回 IR。 */
  run<T>(fn: () => T): Promise<T>;
  /** 可选：把某区域栅格化成 data URI；无此能力 → 不做栅格回退。 */
  rasterize?(rect: Rect, scale: number): Promise<string>;
}
```

---

## 4. 元素转换策略

（下表已按**实际实现**更新；规划期设想但实测后改走栅格回退的项已标注。）

| HTML/CSS 特性 | 实际 SVG 表达 | 说明 |
|---|---|---|
| 块/行盒背景色 | `<rect>` | 圆角→ `rx/ry`，不规则圆角→ `<path>` |
| `background-image: url()` / repeat | **栅格回退** | 规划的 `<pattern>` 未做——收益低、定位语义复杂 |
| 边框（四边同色同宽） | `<rect>`/`<path>` + `stroke` | solid / dashed / dotted |
| 边框（四边异色/异宽） | 逐边 `<rect>` 填充 | double / groove / ridge → 栅格回退 |
| `border-radius` | `<path>`(圆角矩形) / `clipPath` | 逐角半径 |
| `box-shadow`（外阴影） | 高斯模糊 filter + mask 防内渗 | **inset 阴影 → 栅格回退** |
| `outline` | 外扩 `stroke`（含 offset、dash） | |
| 文本 | `<text>` 逐行 | 见 §5；含 decoration / transform / ellipsis / 渐变文字 / ::marker |
| `<img>` | `<image>` base64 | object-fit → preserveAspectRatio；CORS 读不到 → 栅格回退 |
| `<canvas>` / `<video>` / `<iframe>` | **栅格回退** | |
| 内联 `<svg>` | 直接搬运节点 | 计算样式内联、currentColor 解析；重复图标 symbol+use 去重 |
| `linear-gradient` | `<linearGradient>` | 单层、百分比 stop、不透明 stop；其余 → 栅格回退 |
| `radial-` / `conic-gradient` | **栅格回退** | SVG 无原生 conic；radial 未向量化 |
| `transform` | `matrix(...)`（仅 2D 平移/缩放） | 旋转 / 斜切 / 3D → **栅格回退** |
| `opacity` | `opacity` 属性（累积） | |
| `overflow:hidden/clip/scroll/auto` | `clipPath` | 可选 unfurl 展开滚动内容（§6） |
| `clip-path` | **栅格回退** | 规划的直译未做 |
| `filter` / `backdrop-filter` / `mask` | **栅格回退** | |
| `mix-blend-mode`（非 normal） | **栅格回退** | 规划的 feBlend 未做 |
| 伪元素 `::before/::after` | 装饰性（空 content + 绝对定位）→ 向量盒 | 其余 → 栅格回退（`tryPseudoBox`） |
| 表单控件 | **栅格回退** | 原生控件外观依赖 OS 主题，截图最稳 |
| closed shadow DOM 自定义元素 | **栅格回退** | open shadow root 正常向量化 |

---

## 5. 文本：最难点与方案

文本是拟合成败的关键。逐字符位置必须和 Chrome 一致（断行、`letter-spacing`、`text-align: justify`、连字、双向文本都会影响）。

**方案：以"行盒"为单位发射，不自己做断行。**
1. 对每个文本节点用 `Range.getClientRects()` 拿到浏览器**已经断好行**的每一行矩形（绝对坐标）。
2. 每行发射一个 `<text>`，`x` = 行盒左缘（`text-anchor:start`），`y` = 基线。
3. 基线由行盒 + 字体度量推算：`baseline = lineBox.top + (ascent 占行高的偏移)`，用 `dominant-baseline` 或显式 `y` 校准。
4. 字体属性（`font-family/size/weight/style`、`letter-spacing`、`word-spacing`、`fill`=color）逐字段复制计算值。

**字体内联两种模式（API 可选）：**
- `fontMode: 'embed'`（默认）：收集页面用到的 `@font-face`，把字体文件 base64 内嵌进 SVG 的 `<style>`。保留可选中文本、体积小；依赖渲染器支持 webfont（浏览器都支持，部分独立 SVG 渲染器不支持）。
- `fontMode: 'outline'`：用 `opentype.js` 把每个字形转 `<path>`。零字体依赖、任何渲染器一致；但失去文本可选性、体积更大。

> 当 `letter-spacing`/`justify` 导致字间距非均匀时，对该行改用逐字形定位（每个 glyph 单独 `<text>`/`<tspan>` 给 `x`），用 `getClientRects` 的逐字符盒校准。

---

## 6. 栅格回退策略（保证"完全拟合"的兜底）

向量做不到 100% 的特性，用**局部栅格化**兜底：把该元素/子树按 `devicePixelRatio` 截高清图，作为 `<image>` 放到 IR 中它原本的绘制位置和尺寸。

**截图能力由后端注入**（见 §3 `CaptureBackend.rasterize`），core 不直接调用任何环境 API。
实现方式：capture 把待回退区域记入 `Scene.rasterTargets`（带 id + 文档坐标），由后端逐区填充：
- Node 后端：`page.screenshot({ clip })` 截取每个区域，base64 内联。
- 插件后端：可视区走 `captureVisibleTab` 裁剪；整页走可选 `debugger` 权限的
  `Page.captureScreenshot`（`captureBeyondViewport`）。**从不滚动拼接**（见 §11）。
- 页内库后端：默认无截图能力 → 回退区域省略；调用方可注入 `rasterize` 选项补上。

回退触发条件（capture 内联判定，每个 `RasterNode` 带 `reason` 字段便于排查）：
- 多层/radial/conic/含透明 stop 的渐变、`background-image: url()`、inset 阴影、
  double/groove/ridge 边框；
- `filter` / `backdrop-filter` / `mask` / `clip-path`、非 normal 的 `mix-blend-mode`、
  旋转/斜切/3D transform；
- 原生表单控件、`<canvas>` / `<video>` / `<iframe>` / `<object>`、closed shadow DOM、
  CORS 读不到的图片；
- 非装饰性的 `::before/::after`（装饰性的由 `tryPseudoBox` 向量化）。

回退不是显式开关：后端提供 `rasterize` 能力即启用，缺席即跳过（区域省略、其余尽力向量）。
另有两个全局兜底选项：`guaranteeFloor`（整页截图垫底）与 `diffPatch`（生成后差分打补丁），见 §8。

---

## 7. 技术栈与依赖

- **语言**：TypeScript（strict）。`core/` 严禁依赖 Node API，保证可 bundle 进浏览器。
- **`core/` 依赖**：仅 `opentype.js`（字体轮廓化，浏览器/Node 通用）+ 轻量自写 CSS 值 parser（计算值已被浏览器规范化，解析压力小）。**不依赖 puppeteer/playwright。**
- **`backends/node/`**：`playwright`（默认，`playwright install chromium` 拉浏览器）。`puppeteer` 作为同接口的可选替代实现；Node 测试里用 CDP `DOMSnapshot.paintOrders` 仅作校验基准。
- **`backends/extension/`**：Chrome Extension MV3（`scripting` / `tabs` 权限），无第三方运行时依赖。
- **测试**：`vitest` + `pixelmatch` + `pngjs`（视觉回归）。
- **构建**：`tsc` 编译 npm 库（ESM）与 CLI `bin`；插件 bundle 由 `esbuild`（`scripts/build-extension.ts`）打包到 `dist/extension/`。

---

## 8. API 设计

```ts
import { htmlToSvg } from 'fitting-html';

const svg: string = await htmlToSvg(html, {
  width: 1280,            // 视口宽（必填）
  height: 720,            // 视口高；省略则按内容高度
  deviceScaleFactor: 2,   // 栅格回退/图片的清晰度
  fontMode: 'embed',      // 'embed' | 'outline' | 'none'
  settleMs: 200,          // 加载后额外等待（迟到的布局/字体）
  guaranteeFloor: false,  // 整页截图作底层 <image>，向量盖其上（保真地板）
  diffPatch: false,       // 生成后渲染回 Chromium 比对，差异区打栅格补丁
});
```

> 规划期设想的 `fallback: 'raster' | 'none'` 没有成为显式选项：是否栅格回退由后端
> 能力决定（`CaptureBackend.rasterize` 缺席即自动跳过）。`background` / `optimize`
> 未实现（defs 去重已默认内建于发射器）。

也支持 URL / 已有 Playwright Page 作为输入：

```ts
htmlToSvg({ url: 'https://example.com' }, opts);
htmlToSvg({ page }, opts);   // 复用调用方的 Playwright page，便于批量
```

CLI：

```
fitting-html input.html -o out.svg --width 1280 --font-mode outline
fitting-html https://example.com -o out.svg
```

**插件 / 页内库**：同一核心，捕获当前页（无需传 width/height，自动取视口）：

```ts
import { captureCurrentPage } from 'fitting-html/browser';
const { svg } = await captureCurrentPage({ fontMode: 'outline' });
// 插件中由 content script 调用；得到 svg 后下载或回传 background
```

---

## 9. 实施里程碑

| 阶段 | 内容 | 产出/验收 |
|---|---|---|
| **M0 基建** | 脚手架、IR 类型、`CaptureBackend` 接口、Node 后端骨架、**纯栅格输出**（整页截图→单 `<image>`）、视觉回归框架 | 跑通端到端管线，建立"天然像素完美"的基线和 diff 工具 |
| **M1 捕获核心** | 页内 DOM walk + **自实现 paint order**（用 CDP `paintOrders` 做 oracle 校验）→ Scene IR | 排序与 Chrome 一致 |
| **M2 盒子** | 背景、纯色边框、`border-radius`、`opacity`、定位 | 纯盒子页面向量化 diff < 阈值 |
| **M3 文本** | 逐行 `<text>`、基线推算、字体 embed/outline | 文本页面 diff < 阈值 |
| **M4 图像与装饰** | `<img>`/canvas 内联、linear/radial 渐变、box-shadow | |
| **M5 变换与裁剪** | transform matrix、overflow/clip-path、异色边框 | |
| **M6 硬骨头 + 回退** | conic、filter、blend、表单控件 → 栅格回退判定引擎 | 真实网页样本整体 diff < 阈值 |
| **M7 多形态** | 浏览器插件后端（MV3）、页内库后端、插件 bundle 构建 | 同核心在插件中跑通 |
| **M8 打磨** | defs 去重、路径/数字精简、可选 minify、CLI/文档 | 体积优化、发布 0.1 |

> 顺序原则：**先用纯栅格建立可度量的基线**，再逐特性把栅格替换成向量，每步都有回归保护——任何时刻输出都是"可用且忠实"的。M1 起捕获即走"纯 DOM、跨环境"路线，M7 把插件形态接上时无需重写核心。

---

## 10. 测试与验收（视觉回归）

度量"完全拟合"的唯一可信方式是像素对比：

1. 在 Chrome 渲染原 HTML → `expected.png`。
2. 在 Chrome 渲染生成的 SVG → `actual.png`（同尺寸、同 DSR）。
3. `pixelmatch(expected, actual)` 算差异像素比例。
4. 每个 fixture 设阈值（如 `< 0.5%` 差异像素），超阈值 fail 并产出 diff 图。

语料库 `test/fixtures/` 按特性分目录（boxes / text / gradients / shadows / transforms / clipping / real-world …），CI 全量跑 diff。**新特性必须先有 fixture。**

**paint order 校验（Node-only oracle，规划项·未实现）**：排序正确性目前由逐像素视觉回归间接钉死（见 §3 偏差说明）。原设想：对每个 fixture，用 CDP `DOMSnapshot.captureSnapshot({includePaintOrder:true})` 取 Chrome 的官方绘制顺序，与我们自实现的 `core/capture/paint-order.ts` 输出逐节点比对。这把"自实现排序"的正确性钉死在 Chrome 行为上，且只在测试期用 CDP、运行期完全不依赖。

---

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| 自实现 paint order 与 Chrome 不一致 | 用 CDP `paintOrders` 做测试 oracle 钉死（§10）；先覆盖常见层叠场景，边角逐 fixture 收敛 |
| 独立 SVG 渲染器不支持 webfont/filter，导致"在 Chrome 里像、在别处不像" | 提供 `outline` 字体模式；明确声明目标渲染器（首版基准=Chromium）；filter 不支持时回退栅格 |
| 文本基线/字间距在边缘场景对不齐 | `getClientRects` 逐字符校准 + 必要时逐 glyph 定位 |
| 大页面 SVG 体积爆炸（尤其 outline / 大量栅格回退） | defs 去重、坐标精度裁剪、可选 minify、回退图按需 DSR |
| conic-gradient / 复杂合成无法向量化 | 局部栅格回退（有截图能力时默认开启）保证忠实 |
| 字体许可证：内嵌字体可能涉及版权 | 文档提示；提供 `outline` 模式只嵌用到的字形子集，降低暴露 |
| 插件形态：跨源字体/图片受 CORS 限制无法读取内联 | content script 经 background `fetch` 或声明 `host_permissions`；读不到时退化为字体引用/栅格回退 |
| 插件形态：`captureVisibleTab` 仅可视区 | **从不滚动页面**（滚动破坏 sticky/lazy-load）：整页栅格走可选 `debugger` 权限的 `Page.captureScreenshot`（`captureBeyondViewport`，单次覆盖全文档）；未授权则省略视口外栅格，向量不受影响 |
| `core/` 误引入 Node 依赖破坏插件可打包性 | 用 lint/构建规则禁止 `core/` import node 内置模块与 puppeteer/playwright（CI 守门） |

---

## 12. 实施现状

M1–M8 的核心已落地并通过端到端验证：

- **捕获**（`src/core/capture/capture.ts`，纯 DOM、可注入）：DOM 遍历（含 open shadow DOM、`display:contents`、`content-visibility` 重置）、层叠 paint order（positioned + z-index 分组）、逐行文本（`Range.getClientRects` + canvas 字体度量推算基线、可选逐字形 x、text-decoration / text-transform / text-overflow:ellipsis / background-clip:text 渐变文字 / 列表 `::marker`）、装饰性 `::before/::after` 向量化（`tryPseudoBox`）、overflow/圆角裁剪栈与可选滚动内容展开（`captureScrollableContent`）、累积不透明度、单层 linear-gradient 解析、现代颜色函数归一（oklch/oklab/…→sRGB）、内联 `<svg>` 转写、`@font-face` 收集与 base64 内联、栅格回退判定（`RasterNode.reason` 可溯源）。
- **发射**（`src/core/emit/svg.ts`，纯函数）：盒子背景、统一/异色边框、圆角（rx 或 path）、外阴影（高斯模糊 filter）、线性渐变 `<linearGradient>`、逐行 `<text>` 或字形轮廓 `<path>`、`<image>` 内联、内联 SVG 图标 defs+use 去重、clipPath/渐变/filter 去重、`@font-face <style>`。
- **字体**：`embed`（base64 内联 @font-face）/ `outline`（opentype.js 字形轮廓化，Node 经 fontconfig 解析系统字体）/ `none` 三种模式。
- **后端**：Node（`backends/node`，Playwright + 截图回退 + 系统字体）、浏览器/页内库（`backends/browser`，纯 DOM + 共享的非滚动 `createViewportRasterizer`）、MV3 插件（`backends/extension`，content script + service worker；**从不滚动页面**，可视区走 `captureVisibleTab`，整页栅格走可选 `debugger` 权限的 `Page.captureScreenshot`）。
- **验证**：`examples/antd-app`（Vite+React+Antd 复杂仪表盘）端到端逐像素对比，embed **差异 < 0.01%**；`examples/mui-app`（MUI Dashboard）~0.34%；`test/` 含发射器单测、扩展纯逻辑单测（viewport-raster / shot-scheduler）、MV3 bundle 完整性、视觉回归（smoke/gradients/outline/图片/子树/页内/文本不丢失等）共 50+ 项，另有门控的扩展 E2E 与真实站点测试。

设计取舍：inset 阴影、conic/radial 渐变、滤镜、表单控件、canvas/video 维持栅格回退（已像素级忠实，向量化收益低/风险高）。
