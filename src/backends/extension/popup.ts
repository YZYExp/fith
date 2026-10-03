/** Popup UI: choose capture options and trigger page or element capture. */
import { DEFAULT_PREFS, PREF_KEYS } from './messages.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const scopeSel = $<HTMLSelectElement>('scope');
const outputSel = $<HTMLSelectElement>('output');
const fontSel = $<HTMLSelectElement>('font');
const status = $<HTMLDivElement>('status');
const controls = [scopeSel, outputSel, fontSel, $<HTMLButtonElement>('page'), $<HTMLButtonElement>('pick')];
let busy = false;
const setDisabled = (disabled: boolean) => controls.forEach((control) => { control.disabled = disabled; });
const showError = (error: unknown) => {
  status.style.color = '#dc2626';
  status.textContent = String(error);
};

// Wait for preferences before allowing capture; stale values fall back to defaults.
setDisabled(true);
chrome.storage.local.get([...PREF_KEYS]).then((saved) => {
  for (const [key, select] of [['fhScope', scopeSel], ['fhOutput', outputSel], ['fhFont', fontSel]] as const) {
    const value = saved[key];
    select.value = typeof value === 'string' && Array.from(select.options).some((option) => option.value === value)
      ? value : DEFAULT_PREFS[key];
  }
}).catch(() => showError('Could not load preferences; using defaults.'))
  .finally(() => setDisabled(false));

const persist = () => chrome.storage.local.set({
  fhScope: scopeSel.value, fhOutput: outputSel.value, fhFont: fontSel.value,
});
for (const select of [scopeSel, outputSel, fontSel]) {
  select.addEventListener('change', () => { persist().catch(() => showError('Could not save preferences.')); });
}

async function trigger(type: 'fh:capture' | 'fh:pick') {
  if (busy) return;
  busy = true;
  setDisabled(true);
  try {
    // Request on the button gesture, before other async work. Denial still lets
    // capture proceed with the current-viewport raster fallback.
    if (type === 'fh:capture' && scopeSel.value === 'full') {
      await chrome.permissions.request({ permissions: ['debugger'] }).catch(() => false);
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) throw new Error('No active tab found.');
    if (tab.url && /^(chrome|edge|about|chrome-extension):/.test(tab.url)) {
      throw new Error("Can't run on this page.");
    }
    await persist();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    status.style.color = '#16a34a';
    status.textContent = type === 'fh:pick' ? 'Starting element picker…' : 'Converting…';
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type, output: outputSel.value, fontMode: fontSel.value, scope: scopeSel.value,
    });
    if (!resp?.ok) throw new Error(resp?.error ?? 'Unknown error');
    if (type === 'fh:pick') {
      window.close();
      return;
    }
    const kb = Math.round((resp.bytes || 0) / 1024);
    status.textContent = kb ? `Done (${kb} KB)` : 'Done';
  } catch (e) {
    showError('Failed: ' + String(e));
  } finally {
    busy = false;
    setDisabled(false);
  }
}

$('page').addEventListener('click', () => { void trigger('fh:capture'); });
$('pick').addEventListener('click', () => { void trigger('fh:pick'); });
