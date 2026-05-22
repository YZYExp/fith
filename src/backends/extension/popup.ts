/** Popup UI: choose output mode + font mode, and trigger whole-page or element capture. */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const outputSel = $<HTMLSelectElement>('output');
const fontSel = $<HTMLSelectElement>('font');
const status = $<HTMLDivElement>('status');

// restore + persist preferences
chrome.storage.local.get(['fhOutput', 'fhFont']).then((s) => {
  if (typeof s.fhOutput === 'string') outputSel.value = s.fhOutput;
  if (typeof s.fhFont === 'string') fontSel.value = s.fhFont;
});
const persist = () =>
  chrome.storage.local.set({ fhOutput: outputSel.value, fhFont: fontSel.value });
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
    await chrome.tabs.sendMessage(tab.id, { type, output: outputSel.value, fontMode: fontSel.value });
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

$('page').addEventListener('click', () => trigger('fh:capture'));
$('pick').addEventListener('click', () => trigger('fh:pick'));
