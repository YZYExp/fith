/**
 * Service worker: triggers capture on the toolbar action, and screenshots the
 * visible tab on demand. The content script scrolls each fallback region into
 * view and composites the slices, so this worker only needs to capture the
 * *current* viewport — it never crops. captureVisibleTab is rate-limited
 * (~2 calls/sec), so calls are serialized, spaced, and retried on quota errors.
 */

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

const MIN_SHOT_GAP_MS = 520; // stay under captureVisibleTab's ~2/sec quota
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Serialize screenshots through a promise chain so concurrent requests don't
// race the rate limiter, and space/retry them on quota errors.
let chain: Promise<unknown> = Promise.resolve();
let lastShot = 0;

async function doShoot(): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = MIN_SHOT_GAP_MS - (Date.now() - lastShot);
    if (wait > 0) await delay(wait);
    try {
      const url = await chrome.tabs.captureVisibleTab({ format: 'png' });
      lastShot = Date.now();
      return url;
    } catch {
      lastShot = Date.now();
      await delay(300 * (attempt + 1)); // back off, then retry
    }
  }
  return null;
}

function shootViewport(): Promise<string | null> {
  const next = chain.then(() => doShoot());
  chain = next.catch(() => {});
  return next;
}

let previewSeq = 0;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'fh:shoot') {
    shootViewport().then((dataUrl) => sendResponse({ dataUrl }));
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
