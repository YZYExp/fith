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

- **点击工具栏图标弹出面板**，可选择：
  - **输出方式**：下载 + 预览 / 仅下载 / 仅预览（即「是否自动下载」）；
  - **字体模式**：embed（可选中文本）/ outline（字形路径）/ 仅引用字体名；
  - **「整页」** 按钮转换整页；**「选择元素」** 按钮进入 inspect 模式。
- **inspect 模式**：鼠标悬停高亮元素，点击即转换该元素子树，`Esc` 取消。也可用 **`Alt+Shift+S`** 或右键菜单「Convert element to SVG…」直接触发。
- 偏好（输出/字体）记忆在 `chrome.storage`；预览在打包的 `viewer.html` 新标签页中显示。
- 内容脚本按需注入（`chrome.scripting`），对扩展安装前已打开的标签页也生效。
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

## 验证

`examples/antd-app/` 是一个复杂的 Vite + React + Ant Design 仪表盘，用作端到端保真度验证：
渲染原页面与生成的 SVG，逐像素对比。在该示例上**差异 < 0.01%**（约 50 / 1.75M 像素，
集中在抗锯齿边缘）。

```bash
pnpm install
pnpm build
pnpm test                # 单元测试 + 视觉回归（emit / smoke / gradients / outline / 字体内嵌 / 子树 / 页内后端，共 19 项）

# 复现 antd 端到端验证：
cd examples/antd-app && pnpm install && pnpm build
pnpm exec vite preview --port 4173 &    # 在 examples/antd-app 目录
pnpm validate http://localhost:4173/ antd 1280   # 在仓库根目录
# 产物在 test/visual/__out__/antd.{svg,expected,actual,diff}.png
```

> **沙箱说明**：本仓库的开发环境屏蔽了 Playwright 的浏览器 CDN，因此用
> `@sparticuz/chromium`（经 npm 分发的 Chromium 二进制）作为浏览器源。正常环境用
> `pnpm exec playwright install chromium` 即可，运行时不依赖 `@sparticuz/chromium`。

## 状态

已实现 M1–M8 的核心：纯 DOM 捕获、层叠 paint order、盒子/边框/圆角/阴影、逐行文本、
线性渐变、内联 SVG 图标向量化、图片内联、overflow/圆角裁剪、不透明度、字体三模式
（embed / outline / none）、子树捕获、栅格回退（变换旋转 / 滤镜 / 表单控件 / canvas 等），
以及 Node / 页内库 / MV3 扩展三种后端。设计与里程碑见 **[DESIGN.md](./DESIGN.md)**。
