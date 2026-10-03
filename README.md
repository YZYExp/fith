# fitting-html

把任意 HTML（含 CSS）**像素级忠实地**转换为一份**纯 SVG**。

- 复用浏览器引擎计算布局，只负责把渲染结果翻译成 SVG —— 不自研排版引擎。
- 向量优先（盒子 / 文本 / 边框 / 圆角 / 阴影 / 线性渐变 / 内联 SVG 图标），SVG 无法忠实表达的特性局部栅格化兜底。
- 输出单个自包含 `.svg`：`@font-face` 字体 base64 内联（`embed`），或字形轮廓化为 `<path>` 彻底去字体依赖（`outline`）；图片、回退图全部内联。
- **捕获层用纯 DOM API 实现、与环境解耦**：同一核心可在 Node（headless Chrome）、浏览器插件、页内库三种形态运行。

## 安装与准备

要求 Node.js ≥ 18，使用 [pnpm](https://pnpm.io)。

```bash
pnpm install                      # 安装依赖
pnpm exec playwright install chromium  # Node 后端需要的 Chromium（运行时浏览器）
pnpm build                        # 编译 TS 到 dist/
```

> 作为依赖使用时：`pnpm add fitting-html`，并确保目标机器有 Chromium（`pnpm exec playwright install chromium`）。

## 用法

### 1. Node 库

```ts
import { htmlToSvg } from 'fitting-html';

const svg = await htmlToSvg('<h1>hello</h1>', { width: 1280 });
// 也支持 URL / 已有 Playwright Page：
await htmlToSvg({ url: 'https://example.com' }, { width: 1280, height: 720 });
```

常用选项：

| 选项 | 默认 | 说明 |
|---|---|---|
| `width` | 必填 | 视口宽（CSS px） |
| `height` | 内容高度 | 视口高；省略则按整页高度 |
| `deviceScaleFactor` | `1` | 栅格回退/图片清晰度 |
| `fontMode` | `embed` | `embed` 内联字体 / `outline` 字形转 `<path>` / `none` 仅引用字体名 |
| `settleMs` | `0` | 加载完成后额外等待（ms），给迟到的布局/字体留时间 |
| `guaranteeFloor` | `false` | 把整页截图作为 `<image>` 底层内嵌（z-order 0），向量盖在其上 —— 视觉保真有了「地板」，代价是体积 +150–800 KB |
| `diffPatch` | `false` | 生成后做一次差分校正：把 SVG 渲染回 Chromium 与原页逐像素对比，差异区域用截图打补丁；多一次页面加载 |
| `executablePath` | Playwright 自带 | 指定 Chromium 路径 |
| `launchArgs` | `[]` | 传给 Chromium 的额外启动参数 |

### 2. CLI

```bash
pnpm build            # 先编译，生成 dist/backends/node/cli.js（bin: fitting-html）

# 通过 bin 运行（pnpm link --global 或安装后）：
fitting-html input.html -o out.svg --width 1280 --scale 2 --font-mode outline
fitting-html https://example.com -o out.svg
# 环境变量 CHROMIUM_PATH 可指定 Chromium 可执行文件路径

# 或开发期直接跑脚本（用仓库自带的 Chromium 源）：
pnpm render input.html out.svg 1280
```

### 3. 页内库（浏览器内，纯 DOM，无 Node）

整页或单个元素子树：

```ts
import { captureCurrentPage, captureElement } from 'fitting-html/browser';

const pageSvg = await captureCurrentPage({ fontMode: 'embed' });
const elSvg = await captureElement(document.querySelector('.card')!); // 裁剪到该元素
```

进阶选项（扩展即基于这些注入点构建）：

- `viewportOnly: true` —— 只捕获当前可视区（坐标视口相对、不重置滚动），视口外内容裁掉；默认整页。
- `rasterize: (rect, scale) => Promise<dataURI | null>` —— 注入截图能力供栅格回退（canvas/视频/滤镜/表单控件等）；纯页内无法截图，省略时这些区域被跳过。
- `outline: Outliner` —— `outline` 字体模式所需的字形轮廓器（`createOutliner`），由调用方传入以免 opentype.js 进默认 bundle。

### 4. Chrome 扩展（MV3）

```bash
pnpm build:extension   # 打包到 dist/extension/
```

在 `chrome://extensions` 打开「开发者模式」→「加载已解压的扩展程序」→ 选择 `dist/extension/`，然后：

- **点击工具栏图标弹出面板**，可选择：
  - **捕获范围**：「可视区域」（默认，仅当前视口）/「整页」（完整文档）；
  - **输出方式**：下载 + 预览 / 仅下载 / 仅预览（即「是否自动下载」）；
  - **「Text & fonts」** 中选择 embed（可选中文本）/ 仅引用字体名；扩展尚未接入字形轮廓器，outline 显示为不可用，历史 outline 偏好自动回到 embed（Node/CLI 支持 outline）；
  - 主按钮随范围显示 **「Capture visible area」/「Capture full page」**；**「Pick an element」** 按钮进入 inspect 模式。
- **inspect 模式**：鼠标悬停高亮元素，点击即转换该元素子树，`Esc` 取消。也可用 **`Alt+Shift+S`** 或右键菜单「Convert element to SVG…」直接触发。
- 偏好（范围/输出/字体）记忆在 `chrome.storage`；预览在打包的 `viewer.html` 新标签页中显示。
- 转换期间面板选项与按钮暂时禁用，同一标签页不会并发转换；偏好保存或预览打开失败会在面板显示错误，可重试。
- 面板显示当前标签页、选项说明、准备/转换/完成状态与失败后的「Retry capture」；浏览器内部页面和扩展商店页面会提前禁用捕获。界面支持深色主题、键盘焦点和减少动画的系统偏好。
- 预览以 SVG 图片显示，页面中的 SVG 脚本或 HTML 不会进入扩展页面；下载仍保留原始 SVG 内容。
- 预览页显示文件名、尺寸、大小，提供缩放、实际尺寸、适应宽度和棋盘格/浅色/深色背景；快捷键 `+` / `-` 缩放、`0` 实际尺寸、`F` 适应宽度，背景与缩放只影响预览。
- 内容脚本按需注入（`chrome.scripting`），对扩展安装前已打开的标签页也生效。
- **扩展从不滚动页面**（滚动会触发 sticky/fixed 重定位、懒加载，破坏捕获）。栅格回退（canvas/视频/滤镜/表单控件等）：
  - 「可视区域」：service worker 的 `captureVisibleTab` 单次截图裁剪；
  - 「整页」：优先用可选 `debugger` 权限（弹窗按钮点击时申请，可拒绝）走
    `chrome.debugger` 的 `Page.captureScreenshot`（`captureBeyondViewport`，一次覆盖折叠线以下）；
    权限检查由 service worker 执行（content script 无 `chrome.permissions`）；未授权则退化为当前视口裁剪，视口外栅格省略（向量部分不受影响）。

> 在支持扩展的浏览器里可用 `pnpm tsx scripts/verify-extension.ts` 做端到端冒烟（无头沙箱通常不支持加载扩展）。

## 工作原理

```
页面 ──(Playwright 注入)──▶ 纯 DOM 捕获脚本 ──▶ Scene IR ──▶ SVG 发射器 ──▶ 纯 SVG
                                                  │
                                       不可向量化的子树 → 后端截图 → 内联 <image>
```

`src/core/` 是零 Node 依赖的纯 TS（捕获 + IR + SVG 发射），可直接打包进浏览器插件；
`src/backends/node/` 用 Playwright 启动 Chromium、注入捕获脚本、为回退区域截图。

## 验证方案

保真度的唯一可信度量是**像素对比**：在同一个 Chromium 里分别渲染「原页面」和「生成的 SVG」，
用 `pixelmatch` 逐像素求差异比例。整套方案分三层，全部固化为脚本：

**1. 单元 + 视觉回归（CI，`pnpm test`）** — `test/**/*.test.ts` + `test/fixtures/*.html`：
发射器单测、扩展纯逻辑单测（`viewport-raster` / `shot-scheduler`）、MV3 bundle 完整性测试、
打包后扩展脚本的 Chromium 回归（整页截图与权限降级、并发保护、预览错误回传、预览隔离与原始下载），
以及 smoke / gradients / outline / 字体内嵌 / 子树捕获 / 页内后端 / 图片捕获 / **oklch 颜色** /
**容器栅格回退（不空白）** / **text-transform** / **可见文本不丢失（结构不变量）** 等回归。
另有两组门控测试：`EXTENSION_E2E=1`（真实加载扩展的完整 Chromium 端到端）与
`REALWORLD_TESTS=1`（在线真实站点）。新特性必须先加 fixture。

**2. 示例应用端到端（`pnpm validate:example <name>`）** — 一条命令完成「构建 → 起静态服务 →
渲染对比 → 写产物 → 超阈值则非零退出」：

```bash
pnpm validate:example antd-app 1280     # examples/antd-app，差异 ~0.003%
pnpm validate:example mui-app  1280     # examples/mui-app（MUI Dashboard：Drawer + x-charts 折线/柱/饼 + 表格），~0.34%
# 字体模式与阈值可调：
pnpm validate:example mui-app 1280 "" outline
FH_THRESHOLD=0.01 pnpm validate:example antd-app
```

**3. 任意 URL / HTML 即席验证（`pnpm validate`）**：

```bash
pnpm validate https://example.com mypage 1280 720
pnpm validate ./some.html mypage 800 600 outline
```

产物统一写到 `test/visual/__out__/<name>.{svg,expected,actual,diff}.png`，可直接肉眼比对。
实现上：`scripts/validate.ts` 是核心 harness（含静态服务 `serveDir`），`scripts/validate-example.ts`
在其上封装示例的构建 / serve / 退出码。另有开发用脚本：`scripts/screenshot-realworld.ts`
（真实站点 live vs SVG 并排截图）、`scripts/verify-extension.ts`（真实加载扩展的下载冒烟）。

**CI（GitHub Actions，`.github/workflows/ci.yml`）**：每次 push / PR 跑 build + 扩展
bundle + 全部测试；扩展完整 E2E（需可加载扩展的 Chromium）仅在 push 时运行。

> **沙箱说明**：本仓库的开发环境屏蔽了 Playwright 的浏览器 CDN，因此开发脚本支持用
> `@sparticuz/chromium`（经 npm 分发的 Chromium 二进制）作为浏览器源（或设
> `CHROMIUM_PATH`）。正常环境用 `pnpm exec playwright install chromium` 即可，
> 运行时不依赖 `@sparticuz/chromium`。

## 状态

M1–M8 核心已落地，三种后端（Node / 页内库 / MV3 扩展）共用同一捕获核心。

**向量化覆盖**：盒子背景 / 统一与异色边框 / 圆角 / 外阴影（含 spread + 高斯模糊）/
outline 描边 / 线性渐变 / 逐行文本（letter/word-spacing、text-decoration、
text-transform、text-overflow:ellipsis、background-clip:text 渐变文字、列表 ::marker）/
内联 SVG 图标（重复图标 defs+use 去重）/ 图片内联（object-fit）/ 装饰性
::before/::after / overflow 与圆角裁剪 / 不透明度 / 2D transform /
现代颜色函数（oklch/oklab/lab/…→sRGB）/ shadow DOM、display:contents、
content-visibility / 滚动容器内容展开（unfurl）。

**栅格回退**（向量无法忠实表达时局部截图兜底）：conic/radial/多层渐变、inset 阴影、
`filter` / `backdrop-filter` / `mix-blend-mode` / `mask` / `clip-path`、3D 或旋转/斜切
transform、表单控件、canvas / video / iframe、closed shadow DOM、CORS 不可读图片。

设计与里程碑见 **[DESIGN.md](./DESIGN.md)**，实施现状详见其 §12。
