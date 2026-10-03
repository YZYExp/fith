/**
 * Service worker: triggers capture on the toolbar action and screenshots on
 * demand. The content script never scrolls; it asks for either the current
 * viewport (fh:shoot, captureVisibleTab — rate-limited, so calls are serialized,
 * spaced, and retried) or an exact document region (fh:shootRegion), the latter
 * via chrome.debugger Page.captureScreenshot with captureBeyondViewport, which
 * reaches below the fold in a single shot without scrolling.
 */
import { createShotScheduler } from './shot-scheduler.js';
import { MAX_REGION_DEVICE_PX, DEFAULT_PREFS, PREF_KEYS } from './messages.js';

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
    const prefs = await chrome.storage.local.get([...PREF_KEYS]);
    await chrome.tabs.sendMessage(tabId, {
      type,
      output: prefs.fhOutput ?? DEFAULT_PREFS.fhOutput,
      fontMode: prefs.fhFont ?? DEFAULT_PREFS.fhFont,
      scope: prefs.fhScope ?? DEFAULT_PREFS.fhScope,
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

const shootViewport = createShotScheduler({
  capture: () => chrome.tabs.captureVisibleTab({ format: 'png' }),
});

// ── chrome.debugger exact-region screenshot (optional permission) ────────────
// Attach lazily and detach after a short idle so the "is debugging" banner stays
// stable for the duration of a capture instead of flickering per region.
let attachedTab: number | null = null;
let detachTimer: ReturnType<typeof setTimeout> | undefined;

async function ensureAttached(tabId: number) {
  if (attachedTab === tabId) return;
  if (attachedTab !== null) {
    try {
      await chrome.debugger.detach({ tabId: attachedTab });
    } catch {
      /* already gone */
    }
  }
  await chrome.debugger.attach({ tabId }, '1.3');
  attachedTab = tabId;
}

function scheduleDetach() {
  clearTimeout(detachTimer);
  detachTimer = setTimeout(async () => {
    if (attachedTab === null) return;
    const id = attachedTab;
    attachedTab = null;
    try {
      await chrome.debugger.detach({ tabId: id });
    } catch {
      /* tab closed */
    }
  }, 4000);
}

/** Reject if `p` doesn't settle within `ms` (so a stalled debugger call can't hang). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/** Screenshot an exact document-coords region (CSS px) at `scale` device px/CSS px. */
async function shootRegion(
  tabId: number,
  rect: { x: number; y: number; width: number; height: number },
  scale: number,
): Promise<string | null> {
  if (!(await chrome.permissions.contains({ permissions: ['debugger'] }).catch(() => false))) return null;
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const s = scale || 1;
  if (rect.width * rect.height * s * s > MAX_REGION_DEVICE_PX) return null; // too big → fall back
  try {
    await ensureAttached(tabId);
    scheduleDetach();
    const res = (await withTimeout(
      chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: s },
      }),
      12_000,
    )) as { data?: string } | undefined;
    return res?.data ? 'data:image/png;base64,' + res.data : null;
  } catch {
    return null; // fall back to the viewport crop in the content script
  }
}

let previewSeq = 0;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'fh:shoot') {
    shootViewport().then((dataUrl) => sendResponse({ dataUrl }));
    return true; // async response
  }
  if (msg?.type === 'fh:shootRegion') {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ dataUrl: null });
      return; // sync
    }
    shootRegion(tabId, msg.rect, msg.scale).then((dataUrl) => sendResponse({ dataUrl }));
    return true; // async response
  }
  if (msg?.type === 'fh:preview') {
    const id = 'svg' + Date.now() + '_' + previewSeq++;
    (async () => {
      try {
        await chrome.storage.session.set({ [id]: { svg: msg.svg, name: msg.name } });
        await chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html?id=' + id) });
        sendResponse({ ok: true });
      } catch (e) {
        await chrome.storage.session.remove(id).catch(() => {});
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async response
  }
});
