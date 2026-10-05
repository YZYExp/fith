/** Popup UI: explain capture options and report progress and recoverable errors. */
import { DEFAULT_PREFS, PREF_KEYS } from './messages.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const scopeSel = $<HTMLSelectElement>('scope');
const outputSel = $<HTMLSelectElement>('output');
const fontSel = $<HTMLSelectElement>('font');
const sourceChk = $<HTMLInputElement>('source');
const status = $<HTMLDivElement>('status');
const pageBtn = $<HTMLButtonElement>('page');
const pickBtn = $<HTMLButtonElement>('pick');
let loading = true;
let busy = false;
let available = false;
let retry = false;

function showStatus(message: string, tone: 'neutral' | 'busy' | 'error' | 'success' = 'neutral') {
  status.textContent = message;
  status.dataset.tone = tone;
  status.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error:\s*/, '');
const showError = (error: unknown) => showStatus(errorText(error), 'error');

function updateControls() {
  for (const select of [scopeSel, outputSel, fontSel]) select.disabled = loading || busy;
  sourceChk.disabled = loading || busy;
  pageBtn.disabled = pickBtn.disabled = loading || busy || !available;
  pageBtn.setAttribute('aria-busy', String(busy));
  $('page-label').textContent = busy ? 'Working…' : retry ? 'Retry capture'
    : scopeSel.value === 'full' ? 'Capture full page' : 'Capture visible area';
}

function explainOptions() {
  $('scope-help').textContent = scopeSel.value === 'full'
    ? 'Entire page. Extra access may be needed for off-screen media.'
    : 'What’s visible now. No scrolling.';
  $('output-help').textContent = outputSel.value === 'preview'
    ? 'Inspect first. Download from the preview.'
    : outputSel.value === 'download' ? 'Save the SVG without opening a tab.' : 'Save the SVG and open a preview tab.';
  $('font-help').textContent = fontSel.value === 'none'
    ? 'Smaller files. Text uses fonts installed on the viewing device.'
    : 'Keep text selectable and include available web fonts.';
  updateControls();
}

function supportedTab(tab?: chrome.tabs.Tab) {
  if (tab?.id == null) return false;
  if (!tab.url) return true;
  try {
    const url = new URL(tab.url);
    return ['http:', 'https:', 'file:'].includes(url.protocol)
      && url.hostname !== 'chromewebstore.google.com'
      && !(url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'));
  } catch { return false; }
}

async function initialize() {
  updateControls();
  const [prefs, tabs] = await Promise.allSettled([
    chrome.storage.local.get([...PREF_KEYS]),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  if (prefs.status === 'fulfilled') {
    for (const [key, select] of [['fhScope', scopeSel], ['fhOutput', outputSel], ['fhFont', fontSel]] as const) {
      const value = prefs.value[key];
      select.value = typeof value === 'string' && Array.from(select.options).some((option) => !option.disabled && option.value === value)
        ? value : DEFAULT_PREFS[key];
    }
  }
  if (prefs.status === 'fulfilled') sourceChk.checked = prefs.value.fhSource === true;
  const tab = tabs.status === 'fulfilled' ? tabs.value[0] : undefined;
  available = supportedTab(tab);
  const name = tab?.title || tab?.url || 'Current tab';
  $('tab-name').textContent = name;
  $('tab-name').title = name;
  loading = false;
  explainOptions();
  if (!available) showStatus('Open a webpage to capture it. Browser pages and the extension store are unavailable.');
  else if (prefs.status === 'rejected') showError('Could not load preferences. Using defaults.');
  else showStatus('Ready to export.');
}

const persist = () => chrome.storage.local.set({
  fhScope: scopeSel.value, fhOutput: outputSel.value, fhFont: fontSel.value, fhSource: sourceChk.checked,
});
sourceChk.addEventListener('change', () => { persist().catch(() => showError('Could not save preferences. Please retry.')); });
for (const select of [scopeSel, outputSel, fontSel]) {
  select.addEventListener('change', () => {
    retry = false;
    explainOptions();
    if (available && !busy) showStatus('Ready to export.');
    persist().catch(() => showError('Could not save preferences. Please retry.'));
  });
}

async function trigger(type: 'fh:capture' | 'fh:pick') {
  if (busy || loading || !available) return;
  busy = true;
  retry = false;
  updateControls();
  showStatus(type === 'fh:pick' ? 'Preparing element picker…' : 'Preparing capture…', 'busy');
  try {
    // Request on the button gesture, before other async work.
    if (type === 'fh:capture' && scopeSel.value === 'full') {
      showStatus('Checking access for full-page capture…', 'busy');
      await chrome.permissions.request({ permissions: ['debugger'] }).catch(() => false);
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!supportedTab(tab)) {
      available = false;
      throw new Error('Open a webpage to capture it. This page is unavailable.');
    }
    await persist();
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['content.js'] });
    showStatus(type === 'fh:pick' ? 'Starting element picker…' : 'Converting the page to SVG…', 'busy');
    const resp = await chrome.tabs.sendMessage(tab.id!, {
      type, output: outputSel.value, fontMode: fontSel.value, scope: scopeSel.value, sourceHtml: sourceChk.checked,
    });
    if (!resp?.ok) throw new Error(resp?.error ?? 'Capture could not be completed. Please retry.');
    if (type === 'fh:pick') { window.close(); return; }
    const size = resp.bytes ? ` · ${(resp.bytes / 1024).toFixed(1)} KB` : '';
    const result = outputSel.value === 'preview' ? 'Preview opened' : outputSel.value === 'download' ? 'SVG exported' : 'SVG exported & preview opened';
    showStatus(result + size + (sourceChk.checked ? ' · source HTML saved' : ''), 'success');
  } catch (e) {
    retry = true;
    showError(e);
  } finally {
    busy = false;
    updateControls();
  }
}

$('page').addEventListener('click', () => { void trigger('fh:capture'); });
$('pick').addEventListener('click', () => { void trigger('fh:pick'); });
void initialize();
