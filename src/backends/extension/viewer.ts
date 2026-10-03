/** Preview captured SVGs in an isolated image with zoom and background controls. */

async function main() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const stage = $('stage');
  const downloadBtn = $<HTMLButtonElement>('download');
  const zoomIn = $<HTMLButtonElement>('zoom-in');
  const zoomOut = $<HTMLButtonElement>('zoom-out');
  const zoomLevel = $<HTMLButtonElement>('zoom-level');
  const fitBtn = $<HTMLButtonElement>('fit');
  const background = $<HTMLSelectElement>('background');
  const controls = [downloadBtn, zoomIn, zoomOut, zoomLevel, fitBtn, background];
  const setDisabled = (disabled: boolean) => controls.forEach((control) => { control.disabled = disabled; });
  setDisabled(true);

  const empty = (message: string, hint = 'Capture the page again from the fitting-html extension.') => {
    const node = document.createElement('div');
    node.id = 'empty';
    const heading = document.createElement('h1');
    const text = document.createElement('p');
    heading.textContent = message;
    text.textContent = hint;
    node.append(heading, text);
    stage.replaceChildren(node);
    $('meta').textContent = 'No SVG loaded';
    $('viewer-status').textContent = message;
  };
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { empty('No preview selected.'); return; }

  try {
    const store = (await chrome.storage.session.get(id)) as Record<string, { svg: string; name: string }>;
    const entry = store[id];
    if (!entry) { empty('Preview expired.'); return; }
    const { svg, name } = entry;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const image = document.createElement('img');
    image.alt = `SVG preview: ${name}`;
    image.draggable = false;
    // Image context disables SVG scripts and isolates captured HTML.
    image.src = url;
    try { await image.decode(); }
    catch {
      URL.revokeObjectURL(url);
      throw new Error('The generated SVG could not be displayed.');
    }
    const canvas = document.createElement('div');
    canvas.className = 'canvas';
    canvas.append(image);
    stage.replaceChildren(canvas);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const size = blob.size >= 1024 * 1024 ? `${(blob.size / (1024 * 1024)).toFixed(1)} MB` : `${(blob.size / 1024).toFixed(1)} KB`;
    $('file-name').textContent = name;
    $('file-name').title = name;
    $('meta').textContent = `${width} × ${height} px · ${size}`;
    document.title = `${name} · fitting-html`;
    $('viewer-status').textContent = 'SVG ready. Scroll to explore.';
    setDisabled(false);

    let scale = 1;
    let fitted = true;
    const fitScale = () => Math.min(1, Math.max(.01, (stage.clientWidth - 64) / Math.max(1, width)));
    const minScale = () => Math.min(.1, fitScale());
    function setScale(next: number, fit = false) {
      const rect = image.getBoundingClientRect();
      const viewport = stage.getBoundingClientRect();
      const cx = viewport.left + stage.clientWidth / 2;
      const cy = viewport.top + stage.clientHeight / 2;
      const sourceX = Math.max(0, Math.min(width, (cx - rect.left) / scale));
      const sourceY = Math.max(0, Math.min(height, (cy - rect.top) / scale));
      scale = Math.max(minScale(), Math.min(4, next));
      fitted = fit;
      image.style.width = width * scale + 'px';
      image.style.height = height * scale + 'px';
      zoomLevel.textContent = `${Math.round(scale * 100)}%`;
      zoomLevel.setAttribute('aria-label', `View at actual size. Current zoom ${Math.round(scale * 100)} percent.`);
      fitBtn.setAttribute('aria-pressed', String(fitted));
      zoomIn.disabled = scale >= 4;
      zoomOut.disabled = scale <= minScale();
      if (fit) { stage.scrollTop = stage.scrollLeft = 0; }
      else {
        const after = image.getBoundingClientRect();
        stage.scrollLeft += after.left + sourceX * scale - cx;
        stage.scrollTop += after.top + sourceY * scale - cy;
      }
    }
    const fit = () => setScale(fitScale(), true);
    fit();
    zoomIn.addEventListener('click', () => setScale(scale * 1.25));
    zoomOut.addEventListener('click', () => setScale(scale / 1.25));
    zoomLevel.addEventListener('click', () => setScale(1));
    fitBtn.addEventListener('click', fit);
    background.addEventListener('change', () => { stage.dataset.background = background.value; });
    const resize = new ResizeObserver(() => { if (fitted) fit(); });
    resize.observe(stage);
    window.addEventListener('pagehide', () => { resize.disconnect(); URL.revokeObjectURL(url); }, { once: true });
    document.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (event.altKey || event.ctrlKey || event.metaKey || target?.closest('input, select, textarea, [contenteditable]')) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); setScale(scale * 1.25); }
      else if (event.key === '-' || event.key === '−') { event.preventDefault(); setScale(scale / 1.25); }
      else if (event.key === '0') { event.preventDefault(); setScale(1); }
      else if (event.key.toLowerCase() === 'f') { event.preventDefault(); fit(); }
    });
    downloadBtn.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
    });
    await chrome.storage.session.remove(id).catch(() => {});
  } catch (e) {
    setDisabled(true);
    empty('Could not open preview.', e instanceof Error ? e.message : String(e));
  }
}

void main();
