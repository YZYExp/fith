import type { ReactNode } from "react";

export type Locale = "zh" | "en";

export const repositoryUrl = "https://github.com/0x0079/fith";
export const benchCorpusUrl = `${repositoryUrl}/blob/main/docs/bench-corpus.md`;

export type FeatureId = "layout" | "file" | "fallback";

export interface UsageExample {
  id: string;
  label: string;
  filename: string;
  description: string;
  code: string;
  note: string;
}

const nodeCode = `import { writeFile } from 'node:fs/promises';
import { htmlToSvg } from './dist/index.js';

const svg = await htmlToSvg('<h1>Hello, SVG</h1>', {
  width: 1280,
  fontMode: 'embed',
});

await writeFile('page.svg', svg);`;

const cliCode = `node dist/backends/node/cli.js \\
  homepage/public/examples/card.html \\
  -o card.svg \\
  --width 520 --height 360 \\
  --font-mode outline`;

const browserCode = `import { captureElement } from 'fitting-html/browser';

const element = document.querySelector('.card');

if (element) {
  const svg = await captureElement(element, {
    fontMode: 'embed',
  });
  console.log(svg);
}`;

export const setupCommand = `git clone https://github.com/0x0079/fith.git
cd fith
pnpm install
pnpm exec playwright install chromium
pnpm build`;

const pct = (value: number, digits: number) => `${(value * 100).toFixed(digits)}%`;

export interface LiveSummary {
  count: number;
  medianDiff: number;
  underOnePercent: number;
  medianTextCoverage: number;
}

const zh = {
  htmlLang: "zh-CN",
  meta: {
    title: "fith — 把 HTML 变成 SVG",
    description:
      "fith 将网页或单个元素转换为自包含 SVG。支持 Node API、CLI、浏览器页内库与 Chrome 扩展，采用向量优先与局部栅格回退。",
  },
  readmeUrl: `${repositoryUrl}/blob/main/README.zh-CN.md`,
  skip: "跳到正文",
  brandHome: "fith 首页",
  language: { label: "语言", switchTo: "English", switchToLabel: "Switch to English" },
  nav: {
    label: "主导航",
    features: "转换能力",
    cases: "真实案例",
    usage: "开始使用",
    docs: "项目文档",
  },
  hero: {
    titleLine1: "把 HTML，",
    titleLine2: (em: ReactNode) => <>变成 {em}</>,
    titleEm: "SVG。",
    intro:
      "将网页或单个元素转换为自包含的 SVG。保留浏览器计算后的布局，让文字、图形和页面细节进入同一份文件。",
    start: "开始使用",
    cases: "看真实案例",
    github: "GitHub 项目",
    meta: "Node API / CLI / 页内库 / Chrome 扩展",
    previewLabel: "fith 的真实转换示例",
    download: "下载 SVG",
    exampleLabel: "示例卡片",
  },
  compare: {
    before: "← 浏览器截图",
    after: "fith SVG →",
    zoomGroup: (label: string) => `${label}缩放`,
    fit: "适应",
    zoomIn: (n: number) => `放大 ${n}×`,
    slider: "分割线位置：左侧截图，右侧 SVG",
    sliderValue: (p: number) => `截图 ${p}%，SVG ${100 - p}%`,
    hintFit: "拖动分割线对比两侧，双击任意位置放大。",
    hintZoomed: "拖动画面平移，双击回到全图。截图在放大后变糊，SVG 保持清晰。",
    altBefore: (label: string) => `${label}：浏览器截图`,
    altAfter: (label: string) => `${label}：fith 生成的 SVG`,
  },
  principle: {
    title: "项目的核心",
    line1: "浏览器负责布局，fith 负责转换。",
    line2: "以向量表达页面，对复杂效果保留局部截图回退。",
  },
  features: {
    eyebrow: "01 / 转换能力",
    title: "为页面，保留表达力。",
    intro: "从页面里的 DOM 与 CSS，到一份可以独立查看和交付的 SVG。",
    items: [
      {
        id: "layout",
        label: "浏览器布局",
        title: "留下页面的细节。",
        description:
          "复用浏览器计算后的布局，转换文字、背景、边框、圆角、阴影、线性 / 径向 / 锥形渐变、2D 变换和遮罩，也支持内联 SVG、伪元素图标与图片。",
      },
      {
        id: "file",
        label: "自包含输出",
        title: "交付一份 SVG。",
        description:
          "图片和局部回退图内联到同一文件。@font-face 字体可内嵌，也可将文字转成字形路径，减少对接收端字体的依赖。",
      },
      {
        id: "fallback",
        label: "向量优先",
        title: "复杂效果，局部兜底。",
        description:
          "能向量化的内容保留为 SVG 图形；透视 3D 变换、video、跨源 iframe 等难以忠实表达的区域才局部栅格化，没有截图能力时由页内 DOM 渲染兜底。",
      },
    ] as { id: FeatureId; label: string; title: string; description: string }[],
  },
  cases: {
    eyebrow: "02 / 真实案例",
    title: "真实的组件库，真实的输出。",
    intro:
      "以下页面用 npm 上的真实 UI 库搭建，由基准测试直接生成：左边是 Chromium 截图，右边是 fith 输出的 SVG。",
    tablist: "真实案例",
    diff: "像素差异",
    text: "矢量文字",
    raster: "栅格面积",
    size: "SVG 大小",
    embed: "字体内嵌（embed）",
    openSvg: "单独打开 SVG",
    liveTitle: "也跑在线上网站",
    liveSummary: (s: LiveSummary) => (
      <>
        基准测试同样转换 {s.count} 个线上站点。像素差异中位数{" "}
        <strong>{pct(s.medianDiff, 2)}</strong>，其中 <strong>{s.underOnePercent}</strong>{" "}
        个低于 1%；矢量文字覆盖中位数 <strong>{pct(s.medianTextCoverage, 0)}</strong>。
      </>
    ),
    liveNote: "线上页面随时间变化，数据取自最近一次基准记录；被拦截或返回空壳的站点不计入。",
    liveLink: "查看完整基准结果",
    tableLabel: "线上站点基准数据",
    site: "站点",
  },
  usage: {
    eyebrow: "03 / 开始使用",
    title: "四种入口，同一个捕获核心。",
    intro: "从自动化脚本到浏览器操作，选择适合你的使用方式。",
    tablist: "fith 使用方式",
    examples: [
      {
        id: "node",
        label: "Node API",
        filename: "convert.mjs",
        description:
          "在仓库构建后，将转换接入脚本或自动化流程。支持 HTML 字符串、URL 和已有的 Playwright Page。",
        code: nodeCode,
        note: "将代码保存为仓库根目录的 convert.mjs，再运行 node convert.mjs。Node 后端使用 Chromium。",
      },
      {
        id: "cli",
        label: "CLI",
        filename: "terminal",
        description: "直接从终端转换 HTML 文件或 URL。可以指定宽度、高度、回退图缩放比例和字体模式。",
        code: cliCode,
        note: "在仓库根目录运行。这里的输入文件就是首页使用的示例；也可以替换成自己的 HTML 或 URL。",
      },
      {
        id: "browser",
        label: "页内库",
        filename: "capture.ts",
        description: "在浏览器中捕获整页或单个元素。核心使用 DOM API，不需要在浏览器运行时依赖 Node。",
        code: browserCode,
        note: "在使用 fitting-html 模块的浏览器项目中运行。需要栅格回退的区域默认由页内 DOM 渲染补齐；也可以提供自己的 rasterize 适配器。",
      },
      {
        id: "extension",
        label: "Chrome 扩展",
        filename: "terminal",
        description: "从浏览器捕获当前视口、整页或选中的元素，可预览或下载结果，并选择字体模式。",
        code: `# 在仓库根目录构建扩展
pnpm build:extension

# 打开 chrome://extensions
# 启用「开发者模式」
# 加载已解压的扩展程序：dist/extension/

# 点击 Capture visible area 捕获视口，
# 或用 Pick an element 选择单个元素`,
        note: "扩展为本地构建后加载，捕获时不会滚动页面。整页模式的视口外栅格区域优先使用可选的 debugger 权限截图；未授权时改由页内 DOM 渲染补齐。",
      },
    ] as UsageExample[],
    setupTitle: "从仓库开始",
    setupText: "项目要求 Node.js ≥ 18。先安装依赖与浏览器，再构建库。",
    setupLink: "查看完整安装与使用说明",
    copy: "复制代码",
    copied: "已复制",
    copyAria: "复制当前示例代码",
    copiedStatus: "代码已复制到剪贴板。",
    copyFailed: "复制失败，请手动选择代码。",
  },
  questions: {
    eyebrow: "04 / 输出与边界",
    title: (
      <>
        了解输出，
        <br />
        也了解边界。
      </>
    ),
    intro: "字体模式、栅格回退和验证方式，决定了结果如何呈现。",
    items: [
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
    ],
  },
  docs: {
    eyebrow: "项目文档",
    title: "从一个页面，开始转换。",
    text: "在 README 中查看配置、扩展加载方式与验证命令，或了解 DOM 捕获到 SVG 输出的设计。",
    readme: "使用文档",
    design: "架构设计",
    issues: "反馈问题",
  },
  footer: {
    tagline: "HTML 与 CSS，自包含 SVG。",
    top: "返回顶部",
  },
};

export type Messages = typeof zh;

const en: Messages = {
  htmlLang: "en",
  meta: {
    title: "fith — Turn HTML into SVG",
    description:
      "fith converts a web page or a single element into a self-contained SVG. Node API, CLI, in-page library and Chrome extension; vector first, with local raster fallback.",
  },
  readmeUrl: `${repositoryUrl}/blob/main/README.md`,
  skip: "Skip to content",
  brandHome: "fith home",
  language: { label: "Language", switchTo: "中文", switchToLabel: "切换到中文" },
  nav: {
    label: "Main",
    features: "Capabilities",
    cases: "Real-world",
    usage: "Get started",
    docs: "Docs",
  },
  hero: {
    titleLine1: "HTML in,",
    titleLine2: (em: ReactNode) => <>{em} out.</>,
    titleEm: "SVG",
    intro:
      "Convert a web page or a single element into a self-contained SVG. fith keeps the layout the browser computed, so text, shapes and page details end up in one file.",
    start: "Get started",
    cases: "See real-world cases",
    github: "GitHub",
    meta: "Node API / CLI / in-page library / Chrome extension",
    previewLabel: "A real fith conversion",
    download: "Download SVG",
    exampleLabel: "Example card",
  },
  compare: {
    before: "← Browser screenshot",
    after: "fith SVG →",
    zoomGroup: (label: string) => `${label} zoom`,
    fit: "Fit",
    zoomIn: (n: number) => `Zoom ${n}×`,
    slider: "Divider position: screenshot on the left, SVG on the right",
    sliderValue: (p: number) => `Screenshot ${p}%, SVG ${100 - p}%`,
    hintFit: "Drag the divider to compare; double-click anywhere to zoom in.",
    hintZoomed:
      "Drag to pan; double-click to fit. The screenshot blurs when zoomed — the SVG stays sharp.",
    altBefore: (label: string) => `${label}: browser screenshot`,
    altAfter: (label: string) => `${label}: SVG generated by fith`,
  },
  principle: {
    title: "The idea",
    line1: "The browser does the layout; fith does the conversion.",
    line2: "Pages become vectors, with local screenshot fallback only for effects SVG can't express.",
  },
  features: {
    eyebrow: "01 / Capabilities",
    title: "Keep what the page says.",
    intro: "From the DOM and CSS in a page to one SVG you can view and ship on its own.",
    items: [
      {
        id: "layout",
        label: "Browser layout",
        title: "Every detail of the page.",
        description:
          "Reuses the layout the browser computed: text, backgrounds, borders, radii, shadows, linear / radial / conic gradients, 2D transforms and masks, plus inline SVG, pseudo-element icons and images.",
      },
      {
        id: "file",
        label: "Self-contained",
        title: "Ship a single SVG.",
        description:
          "Images and fallback rasters are inlined into the same file. @font-face fonts can be embedded, or text turned into glyph outlines so the viewer needs no fonts.",
      },
      {
        id: "fallback",
        label: "Vector first",
        title: "Raster only where it must.",
        description:
          "Anything vectorizable stays SVG. Only regions SVG can't reproduce faithfully — perspective 3D transforms, video, cross-origin iframes — are rasterized locally, and in-page DOM rendering fills in where no screenshot exists.",
      },
    ],
  },
  cases: {
    eyebrow: "02 / Real-world cases",
    title: "Real UI libraries, real output.",
    intro:
      "These pages are built from real UI libraries on npm and generated straight from the benchmark: Chromium's screenshot on the left, fith's SVG on the right.",
    tablist: "Real-world cases",
    diff: "Pixel diff",
    text: "Vector text",
    raster: "Raster area",
    size: "SVG size",
    embed: "fonts embedded (embed)",
    openSvg: "Open the SVG",
    liveTitle: "Live sites too",
    liveSummary: (s: LiveSummary) => (
      <>
        The benchmark also converts {s.count} live sites. Median pixel diff{" "}
        <strong>{pct(s.medianDiff, 2)}</strong>, with <strong>{s.underOnePercent}</strong>{" "}
        under 1%; median vector-text coverage <strong>{pct(s.medianTextCoverage, 0)}</strong>.
      </>
    ),
    liveNote:
      "Live pages change over time; numbers come from the latest benchmark run. Sites that served a bot wall or an empty shell are excluded.",
    liveLink: "Full benchmark results",
    tableLabel: "Live-site benchmark",
    site: "Site",
  },
  usage: {
    eyebrow: "03 / Get started",
    title: "Four entry points, one capture core.",
    intro: "From automation scripts to the browser — pick what fits.",
    tablist: "Ways to use fith",
    examples: [
      {
        id: "node",
        label: "Node API",
        filename: "convert.mjs",
        description:
          "Once the repository is built, call it from scripts and pipelines. Accepts an HTML string, a URL or an existing Playwright Page.",
        code: nodeCode,
        note: "Save as convert.mjs in the repository root and run node convert.mjs. The Node backend drives Chromium.",
      },
      {
        id: "cli",
        label: "CLI",
        filename: "terminal",
        description:
          "Convert an HTML file or URL from the terminal, with width, height, fallback-raster scale and font mode.",
        code: cliCode,
        note: "Run from the repository root. The input is the example used on this page; swap in your own HTML or URL.",
      },
      {
        id: "browser",
        label: "In-page library",
        filename: "capture.ts",
        description:
          "Capture the whole page or one element inside the browser. The core uses DOM APIs only — no Node at runtime.",
        code: browserCode,
        note: "Run in a browser project that uses the fitting-html module. Regions that need a raster are re-rendered from the DOM in-page by default; you can also pass your own rasterize adapter.",
      },
      {
        id: "extension",
        label: "Chrome extension",
        filename: "terminal",
        description:
          "Capture the visible area, the full page or a picked element from the browser; preview or download, and choose the font mode.",
        code: `# Build the extension in the repository root
pnpm build:extension

# Open chrome://extensions
# Turn on "Developer mode"
# Load unpacked: dist/extension/

# Click "Capture visible area",
# or "Pick an element" for a single element`,
        note: "Load your local build. Capturing never scrolls the page. In full-page mode, off-screen raster regions use the optional debugger permission for an exact screenshot; without it they are re-rendered from the DOM in-page.",
      },
    ],
    setupTitle: "Start from the repository",
    setupText: "Requires Node.js ≥ 18. Install dependencies and the browser, then build the library.",
    setupLink: "Full installation and usage guide",
    copy: "Copy",
    copied: "Copied",
    copyAria: "Copy this example",
    copiedStatus: "Code copied to the clipboard.",
    copyFailed: "Copy failed — select the code manually.",
  },
  questions: {
    eyebrow: "04 / Output and limits",
    title: (
      <>
        Know the output,
        <br />
        and its limits.
      </>
    ),
    intro: "Font mode, raster fallback and how fidelity is measured decide what you get.",
    items: [
      {
        title: "Is the output all vector?",
        answer:
          "It is an SVG file, but not every region is guaranteed to be vector. Text and supported graphics are vectorized first; what can't be expressed faithfully (perspective 3D transforms, video, cross-origin iframes) is inlined as a local image. Each real-world case shows its raster area.",
      },
      {
        title: "Which font mode should I use?",
        answer:
          "embed (default) embeds @font-face fonts and keeps real text; outline turns glyphs into paths, so no fonts are needed but the text is no longer text; none only references font names and depends on the viewer's fonts.",
      },
      {
        title: "How is fidelity checked?",
        answer:
          "The original HTML and the generated SVG are rendered in the same Chromium and pixel-diffed, while vector-text coverage and raster area are measured too — so a full-page screenshot can't pass as fidelity. The repository has visual regression tests and a real-site benchmark (pnpm bench); run pnpm validate on your own pages.",
      },
      {
        title: "Can the in-page library handle complex effects?",
        answer:
          "It can't take screenshots. Regions that need a raster are cloned with inlined computed styles and drawn through an SVG foreignObject onto a canvas; blend modes, filter overflow outside the element box and iframe content are limited on that path. You can pass your own rasterize adapter. The Node backend and the extension use real screenshots.",
      },
    ],
  },
  docs: {
    eyebrow: "Documentation",
    title: "Start with one page.",
    text: "See the README for options, loading the extension and validation commands, or read how DOM capture becomes SVG output.",
    readme: "README",
    design: "Design (Chinese)",
    issues: "Report an issue",
  },
  footer: {
    tagline: "HTML and CSS, as a self-contained SVG.",
    top: "Back to top",
  },
};

export const messages: Record<Locale, Messages> = { zh, en };
