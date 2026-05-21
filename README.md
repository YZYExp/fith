# fitting-html

把任意 HTML（含 CSS）**像素级忠实地**转换为一份**纯 SVG**。

- 复用浏览器引擎计算布局，只负责把渲染结果翻译成 SVG —— 不自研排版引擎。
- 向量优先（盒子 / 文本 / 边框 / 渐变 / 阴影），SVG 无法忠实表达的特性局部栅格化兜底。
- 输出单个自包含 `.svg`（字体、图片、回退图全部内联）。
- **捕获层用纯 DOM API 实现、与环境解耦**：同一核心可在 Node（headless Chrome）、**浏览器插件**、页内库三种形态运行。

```ts
import { htmlToSvg } from 'fitting-html';

const { svg } = await htmlToSvg('<h1>hello</h1>', { width: 1280, fontMode: 'embed' });
```

设计与实施规划见 **[DESIGN.md](./DESIGN.md)**。当前处于 M0（脚手架 + IR + 公共 API）。
