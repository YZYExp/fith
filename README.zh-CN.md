# fith — HTML to SVG

**将浏览器渲染后的 HTML 转换为便于分享的、向量优先的 SVG。**

[English](./README.md) · [简体中文](./README.zh-CN.md)

fith 读取浏览器计算后的布局，把 HTML 页面或元素捕获为 SVG。文字、盒子、边框、渐变及支持的效果转换为 SVG 图形；SVG 表达不了的区域，在后端能提供截图时以局部图片兜底。适合从现有 HTML 导出 UI 卡片、仪表盘、插图和页面快照。

> 向量优先不代表全向量，也不保证任意页面都像素级还原。保真度取决于页面、字体、后端和 SVG 查看器，见[支持范围与限制](./docs/zh/limitations.md)。

| HTML 截图 | SVG 输出 |
| --- | --- |
| ![示例 HTML 卡片截图](./homepage/public/examples/card.png) | ![示例卡片转换后的 SVG](./homepage/public/examples/card.svg) |

**fith** 源自 **fitting HTML**：`fit` 表示「拟合」，`h` 表示 HTML。

## 安装

需要 Node.js 18+ 和 pnpm。首个 npm 版本还没有发布，先从源码构建：

```bash
git clone https://github.com/0x0079/fith.git
cd fith
pnpm install
pnpm exec playwright install chromium
pnpm build
```

发布后用 `npm install fith playwright`（Playwright 是可选 peer，只有 Node 后端需要）。

## 使用

**命令行**

```bash
node dist/backends/node/cli.js homepage/public/examples/card.html -o card.svg --width 520 --height 360
# 安装包之后：fith input.html -o out.svg
```

**Node**

```js
import { htmlToSvg } from 'fith/node'; // 源码目录里用 './dist/node.js'

const svg = await htmlToSvg('<h1>Hello, SVG</h1>', { width: 800, height: 300 });
```

**浏览器**（无需 Node 和 Playwright）

```ts
import { captureElement } from 'fith/browser';

const svg = await captureElement(document.querySelector('.card')!);
```

**Chrome 扩展**：`pnpm build:extension`，然后在 `chrome://extensions` 加载 `dist/extension/`。

## 包入口

| 入口 | 内容 | 依赖 |
|---|---|---|
| `fith` | 场景类型、`emitSvg`、`buildReport` | 无 |
| `fith/node` | `htmlToSvg`、`renderToSvg`、`renderDetailed` | 可选 peer `playwright`（`fontMode: 'outline'` 另需 `opentype.js`） |
| `fith/browser` | `captureCurrentPage`、`captureElement`、`captureSourceHtml` | 无 |
| `fith/outline` | 浏览器里 outline 模式用的 `createOutliner` | 可选 peer `opentype.js` |

## 文档

- [Node API 与 CLI](./docs/zh/node-cli.md)：选项、页面与 URL、用于反馈问题的源码快照
- [浏览器页内库](./docs/zh/browser.md)：`rasterize`、`fonts`、`idPrefix`，以及哪些内容没有画成矢量的报告
- [Chrome 扩展](./docs/zh/extension.md)
- [字体处理](./docs/zh/fonts.md)：`embed`、`outline`、`none`
- [支持范围与限制](./docs/zh/limitations.md)
- [开发](./docs/zh/development.md)：工作原理、验证、测试、参与贡献
- 设计文档：[DESIGN.md](./DESIGN.md)、[.design/](./.design/)

## 参与贡献

欢迎提交 [Issue](https://github.com/0x0079/fith/issues) 或 PR。报告渲染问题时，请附上最小 HTML 复现、后端、视口尺寸和字体模式。提交前运行 `pnpm build`、`pnpm build:extension` 和 `pnpm test`。

## 许可证

[Mozilla Public License 2.0](./LICENSE)。字体、图片和被捕获页面的内容保留各自的许可证。
