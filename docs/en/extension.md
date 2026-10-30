# Chrome extension

```bash
pnpm build:extension
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/extension/`.

- Capture the **visible area** (default), **full page**, or **a picked element**.
- Choose download, preview, or both. The preview includes zoom and background controls.
- Pick an element from the popup, with `Alt+Shift+S`, or through the context menu; press `Esc` to cancel selection.
- Choose `embed` or `none` for fonts. Outline mode is currently unavailable in the extension.

The extension does not scroll the document to stitch screenshots. Visible-area raster fallback uses `captureVisibleTab`. Full-page raster fallback can use the optional **debugger** permission for regions beyond the viewport. If that permission is declined, off-screen raster regions are omitted while supported vectors can still be exported. Browser internal pages and extension store pages cannot be captured.

The manifest requests `activeTab`, `tabs`, `scripting`, `contextMenus`, `storage`, and `<all_urls>` host access; `debugger` is optional. See the [manifest](../../src/backends/extension/manifest.json) for the exact permissions.
