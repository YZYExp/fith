# Chrome 扩展

```bash
pnpm build:extension
```

打开 `chrome://extensions`，启用**开发者模式**，点击**加载已解压的扩展程序**，选择 `dist/extension/`。

- 捕获**可视区域**（默认）、**整页**或**选中的元素**。
- 选择下载、预览或两者同时进行；预览支持缩放与背景切换。
- 通过面板、`Alt+Shift+S` 或右键菜单进入元素选择模式，按 `Esc` 取消。
- 字体支持 `embed` 与 `none`，扩展暂不支持 outline 模式。

扩展不会滚动文档来拼接截图。可视区栅格回退使用 `captureVisibleTab`；整页捕获可通过可选的 **debugger** 权限获取视口外区域截图。拒绝该权限时，视口外栅格区域会被省略，支持的向量内容仍可导出。浏览器内部页面和扩展商店页面无法捕获。

扩展声明了 `activeTab`、`tabs`、`scripting`、`contextMenus`、`storage` 权限及 `<all_urls>` 主机访问权限，`debugger` 为可选权限。完整声明见 [manifest](../../src/backends/extension/manifest.json)。
