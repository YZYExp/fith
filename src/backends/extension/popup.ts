/** Popup UI: choose output mode + font mode, and trigger whole-page or element capture. */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const scopeSel = $<HTMLSelectElement>('scope');
const outputSel = $<HTMLSelectElement>('output');
const fontSel = $<HTMLSelectElement>('font');
const status = $<HTMLDivElement>('status');

// restore + persist preferences
chrome.storage.local.get(['fhScope', 'fhOutput', 'fhFont']).then((s) => {
  if (typeof s.fhScope === 'string') scopeSel.value = s.fhScope;
  if (typeof s.fhOutput === 'string') outputSel.value = s.fhOutput;
  if (typeof s.fhFont === 'string') fontSel.value = s.fhFont;
});
const persist = () =>
  chrome.storage.local.set({ fhScope: scopeSel.value, fhOutput: outputSel.value, fhFont: fontSel.value });
scopeSel.addEventListener('change', persist);
outputSel.addEventListener('change', persist);
fontSel.addEventListener('change', persist);

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Inject the content script on demand so capture works on already-open tabs. */
async function ensureInjected(tabId: number) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function trigger(type: 'fh:capture' | 'fh:pick') {
  const tab = await activeTab();
  if (!tab?.id) return;
  if (tab.url && /^(chrome|edge|about|chrome-extension):/.test(tab.url)) {
    status.style.color = '#dc2626';
    status.textContent = "Can't run on this page.";
    return;
  }
  await persist();
  try {
    await ensureInjected(tab.id);
    await chrome.tabs.sendMessage(tab.id, {
      type,
      output: outputSel.value,
      fontMode: fontSel.value,
      scope: scopeSel.value,
    });
    if (type === 'fh:pick') {
      window.close(); // let the user interact with the page
    } else {
      status.style.color = '#16a34a';
      status.textContent = 'Converting…';
    }
  } catch (e) {
    status.style.color = '#dc2626';
    status.textContent = 'Failed: ' + String(e);
  }
}

$('page').addEventListener('click', async () => {
  // Full-page capture can reach below-the-fold raster content (canvas/video/…)
  // without scrolling via chrome.debugger. Request that optional permission on
  // this user gesture (no-op if already granted). Capture proceeds either way —
  // if denied, off-screen raster is simply omitted (full vector is unaffected).
  if (scopeSel.value === 'full') {
    try {
      await chrome.permissions.request({ permissions: ['debugger'] });
    } catch {
      /* proceed with the viewport-crop fallback */
    }
  }
  trigger('fh:capture');
});
$('pick').addEventListener('click', () => trigger('fh:pick'));
