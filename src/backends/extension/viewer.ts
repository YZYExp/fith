/** Extension page that previews a generated SVG handed off via storage.session. */

async function main() {
  const id = new URLSearchParams(location.search).get('id');
  const stage = document.getElementById('stage')!;
  const meta = document.getElementById('meta')!;
  const downloadBtn = document.getElementById('download') as HTMLButtonElement;
  downloadBtn.disabled = true;

  const empty = (message: string) => {
    const node = document.createElement('div');
    node.id = 'empty';
    node.textContent = message;
    stage.replaceChildren(node);
  };
  if (!id) {
    empty('No preview id.');
    return;
  }

  try {
    const store = (await chrome.storage.session.get(id)) as Record<string, { svg: string; name: string }>;
    const entry = store[id];
    if (!entry) {
      empty('Preview expired.');
      return;
    }

    const { svg, name } = entry;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    window.addEventListener('pagehide', () => URL.revokeObjectURL(url), { once: true });
    const image = document.createElement('img');
    image.alt = `SVG preview: ${name}`;
    // Image context disables SVG scripts and isolates foreign HTML. Never insert captured
    // page markup into the privileged extension document with innerHTML.
    image.src = url;
    try {
      await image.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('The generated SVG could not be displayed.');
    }
    stage.replaceChildren(image);
    meta.textContent = `${name} · ${(blob.size / 1024).toFixed(1)} KB`;
    document.title = `${name} · fitting-html`;
    downloadBtn.disabled = false;
    downloadBtn.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
    });

    // Free the handoff only after successful rendering.
    await chrome.storage.session.remove(id).catch(() => {});
  } catch (e) {
    empty('Could not open preview: ' + String(e));
  }
}

void main();
