export const repositoryUrl = "https://github.com/0x0079/fitting-html";
export const readmeUrl = `${repositoryUrl}/blob/main/README.md`;

export const features = [
  {
    id: "layout",
    number: "01",
    label: "浏览器布局",
    title: "留下页面的细节。",
    description:
      "复用浏览器计算后的布局，转换文字、背景、边框、圆角、阴影和线性渐变，也支持内联 SVG 与图片。",
  },
  {
    id: "file",
    number: "02",
    label: "自包含输出",
    title: "交付一份 SVG。",
    description:
      "图片和局部回退图内联到同一文件。@font-face 字体可内嵌，也可将文字转成字形路径，减少对接收端字体的依赖。",
  },
  {
    id: "fallback",
    number: "03",
    label: "向量优先",
    title: "复杂效果，局部兜底。",
    description:
      "能向量化的内容保留为 SVG 图形；滤镜、canvas、视频等难以忠实表达的区域，由支持截图的后端局部栅格化。",
  },
] as const;

export interface UsageExample {
  id: string;
  label: string;
  filename: string;
  description: string;
  code: string;
  note: string;
}

export const usageExamples: readonly UsageExample[] = [
  {
    id: "node",
    label: "Node API",
    filename: "convert.mjs",
    description:
      "在仓库构建后，将转换接入脚本或自动化流程。支持 HTML 字符串、URL 和已有的 Playwright Page。",
    code: `import { writeFile } from 'node:fs/promises';
import { htmlToSvg } from './dist/index.js';

const svg = await htmlToSvg('<h1>Hello, SVG</h1>', {
  width: 1280,
  fontMode: 'embed',
});

await writeFile('page.svg', svg);`,
    note: "将代码保存为仓库根目录的 convert.mjs，再运行 node convert.mjs。Node 后端使用 Chromium。",
  },
  {
    id: "cli",
    label: "CLI",
    filename: "terminal",
    description:
      "直接从终端转换 HTML 文件或 URL。可以指定宽度、高度、回退图缩放比例和字体模式。",
    code: `node dist/backends/node/cli.js \\
  homepage/public/examples/card.html \\
  -o card.svg \\
  --width 520 --height 360 \\
  --font-mode outline`,
    note: "在仓库根目录运行。这里的输入文件就是首页使用的示例；也可以替换成自己的 HTML 或 URL。",
  },
  {
    id: "browser",
    label: "页内库",
    filename: "capture.ts",
    description:
      "在浏览器中捕获整页或单个元素。核心使用 DOM API，不需要在浏览器运行时依赖 Node。",
    code: `import { captureElement } from 'fitting-html/browser';

const element = document.querySelector('.card');

if (element) {
  const svg = await captureElement(element, {
    fontMode: 'embed',
  });
  console.log(svg);
}`,
    note: "在使用 fitting-html 模块的浏览器项目中运行。若需要局部截图回退，需要提供 rasterize 适配器。",
  },
  {
    id: "extension",
    label: "Chrome 扩展",
    filename: "terminal",
    description:
      "从浏览器捕获当前视口、整页或选中的元素，可预览或下载结果，并选择字体模式。",
    code: `# 在仓库根目录构建扩展
pnpm build:extension

# 打开 chrome://extensions
# 启用「开发者模式」
# 加载已解压的扩展程序：dist/extension/

# 点击 Capture page，或用 Pick element 选择元素`,
    note: "扩展为本地构建后加载。整页的视口外栅格回退依赖可选 debugger 权限；未授权时这些栅格区域会被省略。",
  },
];

export const setupCommand = `git clone https://github.com/0x0079/fitting-html.git
cd fitting-html
pnpm install
pnpm exec playwright install chromium
pnpm build`;

export const questions = [
  {
    title: "输出是全向量吗？",
    answer:
      "输出是 SVG 文件，但不保证每个区域都是向量。文字和可支持的图形优先转换为向量；无法忠实表达的内容可作为局部图片内联。滤镜、canvas、video、iframe 等属于回退范围。",
  },
  {
    title: "三种字体模式怎么选？",
    answer:
      "embed 是默认模式，可内嵌 @font-face 字体，并保留文本；outline 将字形转成路径，减少字体依赖，但文字不再以文本形式存在；none 仅引用字体名，结果依赖查看端的字体环境。",
  },
  {
    title: "如何判断转换是否保真？",
    answer:
      "项目在同一个 Chromium 中渲染原 HTML 和生成的 SVG，通过像素对比验证。仓库包含视觉回归测试，也可以运行 pnpm validate 检查自己的页面。",
  },
  {
    title: "浏览器页内库也能截取复杂效果吗？",
    answer:
      "页内库不能自行截图，需要由调用方提供 rasterize 适配器。省略适配器时，需要栅格化的区域可能无法完整呈现。Node 后端和扩展提供各自的截图路径，具体行为见项目文档。",
  },
] as const;
