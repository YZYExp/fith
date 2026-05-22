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
| `executablePath` | Playwright 自带 | 指定 Chromium 路径 |

### 2. CLI

```bash
pnpm build            # 先编译，生成 dist/backends/node/cli.js（bin: fitting-html）

# 通过 bin 运行（pnpm link --global 或安装后）：
fitting-html input.html -o out.svg --width 1280 --scale 2 --font-mode outline
fitting-html https://example.com -o out.svg

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

### 4. Chrome 扩展（MV3）

```bash
pnpm build:extension   # 打包到 dist/extension/
```

在 `chrome://extensions` 打开「开发者模式」→「加载已解压的扩展程序」→ 选择 `dist/extension/`，然后：

- **点击工具栏图标** → 整页转为 SVG。
- **`Alt+Shift+S` 或右键菜单「Convert element to SVG…」** → 进入 inspect 模式：鼠标悬停高亮元素，点击即转换该元素子树，`Esc` 取消。
- 每次转换都会**下载 `.svg`** 并在**新标签页预览**。
- 栅格回退（canvas/视频/滤镜/表单控件等）由 service worker 的 `captureVisibleTab` 提供；inspect 选区裁剪由核心的子树捕获支持。

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

**1. 单元 + 视觉回归（CI，`pnpm test`）** — `test/visual/*.test.ts` + `test/fixtures/*.html`：
发射器单测，以及 smoke / gradients / outline / 字体内嵌 / 子树捕获 / 页内后端 / **oklch 颜色** /
**容器栅格回退（不空白）** / **text-transform** 等回归。新特性必须先加 fixture。

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
在其上封装示例的构建 / serve / 退出码。

```bash
pnpm install
pnpm exec playwright install chromium    # 浏览器（运行时/验证都需要）
pnpm build
pnpm test
```

> **沙箱说明**：本仓库的开发环境屏蔽了 Playwright 的浏览器 CDN，因此用
> `@sparticuz/chromium`（经 npm 分发的 Chromium 二进制）作为浏览器源。正常环境用
> `pnpm exec playwright install chromium` 即可，运行时不依赖 `@sparticuz/chromium`。

## 状态

已实现 M1–M8 的核心：纯 DOM 捕获、层叠 paint order、盒子/边框/圆角/阴影、逐行文本、
线性渐变、内联 SVG 图标向量化、图片内联、overflow/圆角裁剪、不透明度、字体三模式
（embed / outline / none）、子树捕获、栅格回退（变换旋转 / 滤镜 / 表单控件 / canvas 等），
以及 Node / 页内库 / MV3 扩展三种后端。设计与里程碑见 **[DESIGN.md](./DESIGN.md)**。
