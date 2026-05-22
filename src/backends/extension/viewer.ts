/** Extension page that previews a generated SVG handed off via storage.session. */

async function main() {
  const id = new URLSearchParams(location.search).get('id');
  const stage = document.getElementById('stage')!;
  const meta = document.getElementById('meta')!;
  const downloadBtn = document.getElementById('download') as HTMLButtonElement;

  if (!id) {
    stage.innerHTML = '<div id="empty">No preview id.</div>';
    return;
  }

  const store = (await chrome.storage.session.get(id)) as Record<string, { svg: string; name: string }>;
  const entry = store[id];
  if (!entry) {
    stage.innerHTML = '<div id="empty">Preview expired.</div>';
    return;
  }

  const { svg, name } = entry;
  stage.innerHTML = svg;
  meta.textContent = `${name} · ${(svg.length / 1024).toFixed(1)} KB`;
  document.title = `${name} · fitting-html`;

  downloadBtn.addEventListener('click', () => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  });

  // free the session entry once consumed
  chrome.storage.session.remove(id);
}

main();
