# Node API 与 CLI

## HTML、URL 与已有 Playwright 页面

```js
import { htmlToSvg } from './dist/node.js';

// 直接传入的字符串会被视为 HTML；URL 必须使用 { url }。
const fromHtml = await htmlToSvg('<h1>Hello</h1>', { width: 1280 });
const fromUrl = await htmlToSvg(
  { url: 'https://example.com' },
  { width: 1280, height: 720 },
);

// 使用已有 Playwright Page 时，先自行准备页面：
// await page.goto(...); await page.waitForSelector(...);
// const fromPage = await htmlToSvg({ page }, { width: 1280 });
```

Node 后端加载 HTML 或 URL 时等待 `networkidle`，捕获前等待 `document.fonts.ready`。可通过 `settleMs` 增加等待时间；需要登录或等待动态内容时，可传入已准备好的 Playwright 页面。捕获会调整已有页面的视口，浏览器生命周期仍由调用方管理。

HTML 字符串与 CLI 文件输入通过 `page.setContent` 加载，没有基于文件路径的资源地址。包含相对路径的图片、样式或脚本时，请使用绝对 URL、显式 `<base href>`，或通过 HTTP 服务加载页面后捕获 URL。

### Node 选项

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `width` | 必填 | 视口宽度，单位为 CSS 像素。 |
| `height` | 文档高度 | 输出高度，单位为 CSS 像素；省略时测量文档高度并扩展视口。 |
| `deviceScaleFactor` | `1` | 浏览器上下文及栅格截图的像素密度，SVG 坐标仍使用 CSS 像素。传入已有 Page 时，像素密度由其上下文决定。 |
| `fontMode` | `'embed'` | `'embed'`、`'outline'` 或 `'none'`，见[字体处理](fonts.md)。 |
| `settleMs` | `0` | 捕获前额外等待的毫秒数。 |
| `executablePath` | Playwright Chromium | 自定义 Chromium 可执行文件路径。 |
| `launchArgs` | 后端默认参数 | 覆盖 Chromium 启动参数。 |
| `guaranteeFloor` | `false` | 在向量内容下嵌入整页截图；增加文件大小，也可能出现叠加伪影。 |
| `diffPatch` | `false` | 在 Chromium 中重新渲染 SVG，与原页面对比后叠加局部栅格补丁；增加捕获开销和栅格内容。 |

`guaranteeFloor` 和 `diffPatch` 是可选的保真辅助选项，不保证输出全向量或完全一致。

## CLI

在源码仓库中直接运行编译后的 CLI：

```bash
node dist/backends/node/cli.js input.html -o out.svg \
  --width 1280 --scale 2 --font-mode outline

node dist/backends/node/cli.js https://example.com \
  -o example.svg --width 1280 --height 720
```

安装或链接包后，同一 CLI 可通过 `fith` 命令调用。默认宽度为 `1280`、缩放比例为 `1`、字体模式为 `embed`、输出文件为 `out.svg`。省略 `--height` 时使用文档高度。CLI 支持通过 `CHROMIUM_PATH` 指定 Chromium 可执行文件。

仓库另有开发辅助命令 `pnpm render input.html out.svg 1280`，使用 `CHROMIUM_PATH` 或开发依赖 `@sparticuz/chromium`。
