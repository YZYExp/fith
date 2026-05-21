# fitting-html

把任意 HTML（含 CSS）**像素级忠实地**转换为一份**纯 SVG**。

- 复用浏览器引擎计算布局，只负责把渲染结果翻译成 SVG —— 不自研排版引擎。
- 向量优先（盒子 / 文本 / 边框 / 圆角 / 阴影 / 线性渐变 / 内联 SVG 图标），SVG 无法忠实表达的特性局部栅格化兜底。
- 输出单个自包含 `.svg`：`@font-face` 字体 base64 内联（`embed`），或字形轮廓化为 `<path>` 彻底去字体依赖（`outline`）；图片、回退图全部内联。
- **捕获层用纯 DOM API 实现、与环境解耦**：同一核心可在 Node（headless Chrome）、浏览器插件、页内库三种形态运行。

## 用法

```ts
import { htmlToSvg } from 'fitting-html';

const svg = await htmlToSvg('<h1>hello</h1>', { width: 1280 });
// 或：await htmlToSvg({ url: 'https://example.com' }, { width: 1280 });
```

CLI：

```
fitting-html input.html -o out.svg --width 1280 --scale 2
fitting-html https://example.com -o out.svg
```

页内 / 浏览器插件（同一核心，纯 DOM，无 Node）：

```ts
import { captureCurrentPage } from 'fitting-html/browser';
const svg = await captureCurrentPage({ fontMode: 'embed' });
// 插件中由 content script 调用，栅格回退经 service worker 的 captureVisibleTab 提供
```

构建 MV3 插件：`npm run build:extension` → `dist/extension/`（`chrome://extensions` 加载）。

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
npm install
npm run build
npm test                 # 单元测试 + 视觉回归（smoke fixture）

# 复现 antd 端到端验证：
cd examples/antd-app && npm install && npm run build
npx vite preview --port 4173 &      # 在 examples/antd-app 目录
npm run validate -- http://localhost:4173/ antd 1280   # 在仓库根目录
# 产物在 test/visual/__out__/antd.{svg,expected,actual,diff}.png
```

> **沙箱说明**：本仓库的开发环境屏蔽了 Playwright 的浏览器 CDN，因此用
> `@sparticuz/chromium`（经 npm 分发的 Chromium 二进制）作为浏览器源。正常环境用
> `npx playwright install chromium` 即可，运行时不依赖 `@sparticuz/chromium`。

## 状态

已实现 M1–M6 的核心：纯 DOM 捕获、层叠 paint order、盒子/边框/圆角/阴影、逐行文本、
图片内联、overflow/圆角裁剪、不透明度、栅格回退（变换旋转 / 滤镜 / 渐变背景 / 表单控件 /
内联 SVG 图标等）。设计与里程碑见 **[DESIGN.md](./DESIGN.md)**。
