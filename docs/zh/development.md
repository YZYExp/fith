# 开发

## 工作原理

```text
浏览器渲染后的 HTML → DOM 捕获 → Scene IR → SVG 发射器 → SVG 文件
                                    ↑
                              后端提供局部截图
```

浏览器负责计算布局。捕获核心读取 DOM 几何信息和计算样式，生成场景表示，再由发射器转换为 SVG。各后端按自身能力提供浏览器访问、截图与字体解析。

| 目录 | 用途 |
| --- | --- |
| `src/core/` | DOM 捕获、场景类型、SVG 发射，不依赖 Node 运行时。 |
| `src/backends/node/` | Playwright 集成、字体解析、CLI 和差分补丁。 |
| `src/backends/browser/` | 页内 API 与栅格适配工具。 |
| `src/backends/extension/` | Manifest V3 面板、捕获 worker、内容脚本及预览器。 |
| `test/` | 单元测试、HTML fixture 与视觉回归测试。 |
| `examples/` | Ant Design 和 MUI 示例应用。 |
| `homepage/` | 项目网站与示例资源。 |

实现细节见 [DESIGN.md](../../DESIGN.md)，更多调查见[保真度研究](../fidelity-research.md)。这两份文档目前为中文。

## 开发与验证

```bash
pnpm build
pnpm build:extension
pnpm test

# 比较自己的 HTML 或 URL 与生成的 SVG
pnpm validate ./homepage/public/examples/card.html card 520 360 embed
pnpm validate https://example.com example 1280 720

# 构建、启动服务并对比示例应用
pnpm validate:example antd-app 1280
pnpm validate:example mui-app 1280
```

验证产物写入 `test/visual/__out__/`，包括 `<name>.svg`、`<name>.expected.png`、`<name>.actual.png` 与 `<name>.diff.png`。示例应用验证在像素差异比例超过 `FH_THRESHOLD` 时以非零状态退出，默认阈值为 `0.02`（2%），可设置 `FH_THRESHOLD=0.01` 使用 1% 阈值。单独的 `pnpm validate` 只报告差异，不应用该阈值。

开发与视觉测试脚本使用 `@sparticuz/chromium` 或 `CHROMIUM_PATH`；生产 Node API 默认使用 Playwright Chromium，也可通过 `executablePath` 指定。

可选测试：

```bash
# 需要能加载扩展的 Chromium 版本
EXTENSION_E2E=1 pnpm exec vitest run test/visual/extension-e2e.test.ts

# 需要访问外部站点
REALWORLD_TESTS=1 pnpm exec vitest run test/visual/realworld.test.ts
```

[CI](../../.github/workflows/ci.yml) 对发往 `main` 的 PR 和配置的 push 分支执行 TypeScript 构建、扩展打包与测试套件；完整扩展 E2E 任务在配置的 push 事件中运行。

## 参与贡献

欢迎提交 [Issue](https://github.com/0x0079/fith/issues) 或 PR。报告渲染问题时，请附上最小 HTML 复现、捕获后端、视口尺寸、字体模式，以及截图或验证产物。

修改渲染行为时，请增加针对性的 fixture 或回归测试。提交前运行 `pnpm build`、`pnpm build:extension` 和 `pnpm test`。PR 标题采用 `docs(readme): improve bilingual setup instructions` 或 `bugfix(capture): preserve clipped text` 这样的格式。

## 发版

推送 `vX.Y.Z` tag 即发布；见 [.design/release.md](../../.design/release.md)。
