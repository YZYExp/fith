# 浏览器页内库

在已安装或本地链接 fith 的浏览器项目中，打包浏览器入口：

```ts
import { captureCurrentPage, captureElement } from 'fith/browser';

const pageSvg = await captureCurrentPage({ fontMode: 'embed' });
const visibleSvg = await captureCurrentPage({ viewportOnly: true });

const card = document.querySelector('.card');
if (card) {
  const cardSvg = await captureElement(card, { fontMode: 'embed' });
  console.log(cardSvg);
}
```

页内库使用 DOM API，运行时不依赖 Node 或 Playwright。它捕获当前布局；`width` 与 `height` 控制捕获尺寸，不会创建新的浏览器视口。

- `viewportOnly: true` 用于捕获当前页面可视区，默认捕获完整文档；元素捕获裁剪到选中的子树。
- `rasterize(rect, scale, { element, reason })` 由调用方提供截图能力，返回 data URI 或 `null`。`element` 是该区域所属的元素（`<iframe>`、`<video>`、3D 变换的盒子……），宿主可以直接用手上已有的图回答。未提供时，需要栅格回退的区域会被省略。
- `idPrefix`（Node 选项里也有）会加在每个生成的 id 前面，这样多份捕获结果放进同一个文档时，clipPath、渐变、滤镜的 id 不会冲突。
- `fonts` 是 `{ family, weight, style, src, format }` 字体列表（`src` 为 data URI），用来代替读取文档的 `@font-face` 规则，适合没有网络的框架。
- 使用 `fontMode: 'outline'` 时，调用方还需提供 `outline` 回调。浏览器入口没有导出字形轮廓器工厂，仅设置模式不会把文字转成路径。

## 哪些内容没有画成矢量

变成图片的区域，或因为没有截图能力而被省略的区域，会列在报告里，而不是静默缺失：

```ts
import { captureElementDetailed } from 'fith/browser';

const { svg, report } = await captureElementDetailed(card);
report.rasters; // { reason, rect, desc, filled: 'screenshot' | 'dom' | 'none' }[]
report.omitted; // 完全没有像素的栅格区域：在 SVG 里是空白
report.fonts;   // { family, mode: 'embedded' | 'outlined' | 'referenced' }[]
```

Node API 的 `renderDetailed()` 在 `svg` 旁边返回同样的 `report`。
