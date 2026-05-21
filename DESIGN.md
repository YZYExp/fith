# fitting-html 设计规划

> 目标：把任意 HTML（含 CSS）**像素级忠实地**转换为一份**纯 SVG**。
> 技术栈：TypeScript / Node.js；布局计算复用浏览器引擎（headless Chrome via Puppeteer + CDP）。

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

### 1.3 为什么选浏览器引擎
"完全拟合" 要求和 Chrome 的盒模型、Flex/Grid、文本断行、字体度量、层叠顺序完全一致。自研排版引擎等于重造浏览器，工作量与误差都不可接受。复用 Chrome 计算布局，我们只负责**把已经算好的渲染结果翻译成 SVG**。

---

## 2. 核心原理

```
HTML ──Puppeteer 加载──▶ Chrome 渲染
                          │
                          ▼
        CDP DOMSnapshot.captureSnapshot
        (computedStyles + layout boxes + paintOrders + text)
                          │
                          ▼
                 Scene IR（中间表示）
        扁平的、按绘制顺序排列的 Paint 节点列表，
        坐标全部是绝对像素，样式已解析为最终计算值
                          │
            ┌─────────────┼──────────────┐
            ▼             ▼              ▼
       向量发射器     资源内联器      栅格回退引擎
   (rect/text/path)  (字体/图片)   (不可表达区域→<image>)
            └─────────────┼──────────────┘
                          ▼
                     纯 SVG 文档
```

关键点：**不手动遍历 DOM 重建绘制顺序**。改用 CDP 的 `DOMSnapshot.captureSnapshot`，一次调用即可拿到全树的计算样式、布局盒、文本盒和**官方 paint order**，从根本上规避层叠上下文 / z-index / float / positioned 的排序坑。

---

## 3. 架构与模块

```
src/
  capture/      浏览器捕获层：启动 Chrome、加载 HTML、跑 CDP 快照
    browser.ts        Puppeteer 生命周期
    snapshot.ts       DOMSnapshot.captureSnapshot 封装 + 解码
    text-runs.ts      Range.getClientRects 取逐行文本盒 + 基线
  ir/           中间表示（架构中枢）
    types.ts          Scene / PaintNode / 各类样式结构（纯类型）
    build.ts          快照 → IR 的规范化
  emit/         SVG 发射器：IR → SVG 字符串
    document.ts       <svg> 骨架、viewBox、defs 管理、id 分配
    box.ts            背景 / 边框 / 圆角 / 阴影
    text.ts           <text> 逐行发射 / 字形轮廓化
    image.ts          <image> 内联
    gradient.ts       CSS 渐变 → SVG 渐变 defs
    clip.ts           overflow / border-radius → clipPath
    transform.ts      CSS transform → matrix
  assets/       资源内联
    fonts.ts          @font-face 收集 + base64 内嵌 / opentype.js 轮廓化
    images.ts         图片/canvas → base64 data URI
  fallback/     栅格回退
    detector.ts       判定某子树是否需要栅格化
    rasterize.ts      对指定区域截图 → <image>
  optimize/     体积优化（defs 去重、路径精简、可选 minify）
  cli.ts        命令行入口
  index.ts      编程式 API
test/
  fixtures/     HTML 语料库（按特性分类）
  visual/       视觉回归框架（render→diff）
```

---

## 4. 元素转换策略

| HTML/CSS 特性 | SVG 表达 | 说明 |
|---|---|---|
| 块/行盒背景色 | `<rect>` | 圆角→ `rx/ry`，不规则圆角→ `<path>` |
| `background-image` | `<image>` 或 `<pattern>` | repeat → `<pattern>`；单图按 `background-position/size` 定位 |
| 边框（四边同色） | `<rect>` + `stroke` | |
| 边框（四边异色/异宽） | 4 条 `<path>` | SVG 单一 stroke 无法表达异色，需逐边路径 + 斜接处理 |
| `border-radius` | `<path>`(圆角矩形) / `clipPath` | |
| `box-shadow` | `<filter>` feDropShadow / feGaussianBlur+feOffset | inset 阴影用 clip+filter 组合 |
| 文本 | `<text>` 逐行 | 见 §5，最难点 |
| `<img>` / `<canvas>` | `<image>` base64 | canvas 用 `toDataURL` |
| 内联 `<svg>` | 直接搬运节点 | 已是 SVG，原样嵌入 |
| linear/radial gradient | `<linearGradient>` / `<radialGradient>` | 角度/坐标做数学换算 |
| `conic-gradient` | 栅格回退 或 多扇形近似 | SVG 无原生 conic |
| `transform` | `transform="matrix(...)"` | 2D 直接；3D 取投影后矩阵 |
| `opacity` | `opacity` 属性 | |
| `overflow:hidden/clip` | `clipPath` | |
| `clip-path` | `clipPath`（多数语法可直译） | |
| `filter`(blur/drop-shadow…) | `<filter>` | 复杂滤镜回退栅格 |
| `mix-blend-mode` | `feBlend` / 栅格回退 | 合成语义不完全一致时回退 |
| 伪元素 `::before/::after` | 作为独立 Paint 节点 | 通过 `getComputedStyle(el,'::before')` 捕获 |
| 表单控件 | 栅格回退 | 原生控件外观依赖 OS 主题，截图最稳 |

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

向量做不到 100% 的特性，用**局部栅格化**兜底：对该元素/子树用 Puppeteer 的 `element.screenshot()`（或 CDP clip 截图）按 `devicePixelRatio` 截高清图，作为 `<image>` 放到 IR 中它原本的绘制位置和尺寸。

回退触发条件（`fallback/detector.ts`）：
- `conic-gradient`、复杂 `filter`/`backdrop-filter`、不可直译的 `mix-blend-mode`；
- 原生表单控件、`<video>`、插件内容；
- 任何被标记为 "向量化误差超阈值" 的子树。

回退是**可配置的**：`fallback: 'raster' | 'none'`。`none` 模式遇到不可表达特性时记录 warning 并尽力近似，适合追求纯向量的场景。

---

## 7. 技术栈与依赖

- **运行时**：Node.js 18+，TypeScript（strict）。
- **浏览器驱动**：`puppeteer`（自带 Chromium）+ 直接用 CDP session 调 `DOMSnapshot` / `Page.captureScreenshot`。
- **字体轮廓化**：`opentype.js`。
- **CSS 解析辅助**：渐变 / transform / filter 值解析用轻量自写 parser（计算值已被浏览器规范化，解析压力小）。
- **测试**：`vitest` + `pixelmatch` + `pngjs`（视觉回归）。
- **构建**：`tsup`/`tsc` 双产物（ESM + CJS），`bin` 暴露 CLI。

---

## 8. API 设计

```ts
import { htmlToSvg } from 'fitting-html';

const svg: string = await htmlToSvg(html, {
  width: 1280,            // 视口宽（必填）
  height: 720,            // 视口高；省略则按内容高度
  deviceScaleFactor: 2,   // 栅格回退/图片的清晰度
  fontMode: 'embed',      // 'embed' | 'outline'
  fallback: 'raster',     // 'raster' | 'none'
  background: '#fff',     // 透明背景可设 'transparent'
  optimize: true,         // defs 去重 + 路径精简
});
```

也支持 URL / 已有 Puppeteer Page 作为输入：

```ts
htmlToSvg({ url: 'https://example.com' }, opts);
htmlToSvg({ page }, opts);   // 复用调用方的 page，便于批量
```

CLI：

```
fitting-html input.html -o out.svg --width 1280 --font-mode outline
fitting-html https://example.com -o out.svg
```

---

## 9. 实施里程碑

| 阶段 | 内容 | 产出/验收 |
|---|---|---|
| **M0 基建** | 脚手架、IR 类型、Puppeteer 捕获、**纯栅格输出**（整页截图→单 `<image>`）、视觉回归框架 | 跑通端到端管线，建立"天然像素完美"的基线和 diff 工具 |
| **M1 盒子** | 背景、纯色边框、`border-radius`、`opacity`、定位、paint order | 纯盒子页面向量化 diff < 阈值 |
| **M2 文本** | 逐行 `<text>`、基线推算、字体 embed/outline | 文本页面 diff < 阈值 |
| **M3 图像与装饰** | `<img>`/canvas 内联、linear/radial 渐变、box-shadow | |
| **M4 变换与裁剪** | transform matrix、overflow/clip-path、异色边框 | |
| **M5 硬骨头 + 回退** | conic、filter、blend、表单控件 → 栅格回退判定引擎 | 真实网页样本整体 diff < 阈值 |
| **M6 打磨** | defs 去重、路径/数字精简、可选 minify、CLI/文档 | 体积优化、发布 0.1 |

> 顺序原则：**先用纯栅格建立可度量的基线**，再逐特性把栅格替换成向量，每步都有回归保护——任何时刻输出都是"可用且忠实"的。

---

## 10. 测试与验收（视觉回归）

度量"完全拟合"的唯一可信方式是像素对比：

1. 在 Chrome 渲染原 HTML → `expected.png`。
2. 在 Chrome 渲染生成的 SVG → `actual.png`（同尺寸、同 DSR）。
3. `pixelmatch(expected, actual)` 算差异像素比例。
4. 每个 fixture 设阈值（如 `< 0.5%` 差异像素），超阈值 fail 并产出 diff 图。

语料库 `test/fixtures/` 按特性分目录（boxes / text / gradients / shadows / transforms / clipping / real-world …），CI 全量跑 diff。**新特性必须先有 fixture。**

---

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| 独立 SVG 渲染器不支持 webfont/filter，导致"在 Chrome 里像、在别处不像" | 提供 `outline` 字体模式；明确声明目标渲染器（首版基准=Chromium）；filter 不支持时回退栅格 |
| 文本基线/字间距在边缘场景对不齐 | `getClientRects` 逐字符校准 + 必要时逐 glyph 定位 |
| 大页面 SVG 体积爆炸（尤其 outline / 大量栅格回退） | defs 去重、坐标精度裁剪、可选 minify、回退图按需 DSR |
| conic-gradient / 复杂合成无法向量化 | 局部栅格回退（默认开启）保证忠实 |
| 字体许可证：内嵌字体可能涉及版权 | 文档提示；提供 `outline` 模式只嵌用到的字形子集，降低暴露 |

---

## 12. 下一步

M0 脚手架（package.json / tsconfig / IR 类型 / 捕获管线骨架 / 视觉回归 harness）已随本规划落地，见 `src/` 与 `test/`。批准后即可从 **M1 盒子向量化** 开始迭代。
