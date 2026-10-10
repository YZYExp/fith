export const repositoryUrl = "https://github.com/0x0079/fith";
export const readmeUrl = `${repositoryUrl}/blob/main/README.md`;
export const benchCorpusUrl = `${repositoryUrl}/blob/main/docs/bench-corpus.md`;

export const features = [
  {
    id: "layout",
    number: "01",
    label: "浏览器布局",
    title: "留下页面的细节。",
    description:
      "复用浏览器计算后的布局，转换文字、背景、边框、圆角、阴影、线性 / 径向 / 锥形渐变、2D 变换和遮罩，也支持内联 SVG、伪元素图标与图片。",
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
      "能向量化的内容保留为 SVG 图形；透视 3D 变换、video、跨源 iframe 等难以忠实表达的区域才局部栅格化，没有截图能力时由页内 DOM 渲染兜底。",
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
    note: "在使用 fitting-html 模块的浏览器项目中运行。需要栅格回退的区域默认由页内 DOM 渲染补齐；也可以提供自己的 rasterize 适配器。",
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

# 点击 Capture visible area 捕获视口，
# 或用 Pick an element 选择单个元素`,
    note: "扩展为本地构建后加载，捕获时不会滚动页面。整页模式的视口外栅格区域优先使用可选的 debugger 权限截图；未授权时改由页内 DOM 渲染补齐。",
  },
];

export const setupCommand = `git clone https://github.com/0x0079/fith.git
cd fith
pnpm install
pnpm exec playwright install chromium
pnpm build`;

export const questions = [
  {
    title: "输出是全向量吗？",
    answer:
      "输出是 SVG 文件，但不保证每个区域都是向量。文字和可支持的图形优先转换为向量；无法忠实表达的内容（如透视 3D 变换、video、跨源 iframe）作为局部图片内联。真实案例中会标出每个页面的栅格面积。",
  },
  {
    title: "三种字体模式怎么选？",
    answer:
      "embed 是默认模式，可内嵌 @font-face 字体，并保留文本；outline 将字形转成路径，减少字体依赖，但文字不再以文本形式存在；none 仅引用字体名，结果依赖查看端的字体环境。",
  },
  {
    title: "如何判断转换是否保真？",
    answer:
      "项目在同一个 Chromium 中渲染原 HTML 和生成的 SVG，通过像素对比验证，并同时统计矢量文字覆盖与栅格面积，避免「整页截图」式的假保真。仓库包含视觉回归测试和真实站点基准（pnpm bench），也可以运行 pnpm validate 检查自己的页面。",
  },
  {
    title: "浏览器页内库也能截取复杂效果吗？",
    answer:
      "页内库不能截屏。需要栅格化的区域会克隆 DOM 并内联计算样式，经 SVG foreignObject 绘制到 canvas 补齐；混合模式、元素框外的滤镜溢出和 iframe 内容在这条路径上有局限。也可以传入自己的 rasterize 适配器。Node 后端和扩展使用真实截图。",
  },
] as const;
