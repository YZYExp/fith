/**
 * Service worker: triggers capture on the toolbar action, and rasterizes
 * fallback regions by screenshotting the visible tab and cropping.
 *
 * Note: captureVisibleTab only sees the current viewport; regions scrolled
 * off-screen are a known limitation of the pure-extension path.
 */
import type { Rect } from '../../core/ir/types.js';

// The toolbar action opens the popup (default_popup in the manifest), so there's
// no action.onClicked here. Context menus and the keyboard command still work and
// inject the content script on demand (so they run on already-open tabs).

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'fh-page', title: 'Convert page to SVG', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'fh-pick', title: 'Convert element to SVG…', contexts: ['all'] });
});

async function send(tabId: number, type: 'fh:capture' | 'fh:pick') {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    const prefs = await chrome.storage.local.get(['fhOutput', 'fhFont']);
    await chrome.tabs.sendMessage(tabId, {
      type,
      output: prefs.fhOutput ?? 'both',
      fontMode: prefs.fhFont ?? 'embed',
    });
  } catch (e) {
    console.error('[fitting-html]', e);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id == null) return;
  if (info.menuItemId === 'fh-pick') send(tab.id, 'fh:pick');
  else if (info.menuItemId === 'fh-page') send(tab.id, 'fh:capture');
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'pick-element') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) send(tab.id, 'fh:pick');
});

let cache: { time: number; dataUrl: string } | null = null;

async function captureViewport(): Promise<string> {
  const now = Date.now();
  if (cache && now - cache.time < 400) return cache.dataUrl;
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
  cache = { time: now, dataUrl };
  return dataUrl;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.readAsDataURL(blob);
  });
}

async function rasterize(rect: Rect, dpr: number): Promise<string | null> {
  try {
    const shot = await captureViewport();
    const bmp = await createImageBitmap(await (await fetch(shot)).blob());
    const sw = Math.max(1, Math.round(rect.width * dpr));
    const sh = Math.max(1, Math.round(rect.height * dpr));
    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, rect.x * dpr, rect.y * dpr, rect.width * dpr, rect.height * dpr, 0, 0, sw, sh);
    return await blobToDataURL(await canvas.convertToBlob({ type: 'image/png' }));
  } catch {
    return null;
  }
}

let previewSeq = 0;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'fh:rasterize') {
    rasterize(msg.rect, msg.dpr || 1).then((dataUrl) => sendResponse({ dataUrl }));
    return true; // async response
  }
  if (msg?.type === 'fh:preview') {
    const id = 'svg' + Date.now() + '_' + previewSeq++;
    chrome.storage.session.set({ [id]: { svg: msg.svg, name: msg.name } }).then(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html?id=' + id) });
      sendResponse({ ok: true });
    });
    return true; // async response
  }
});
