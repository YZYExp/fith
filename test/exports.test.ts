import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { build } from 'esbuild';

/** What each public entry pulls in: the environment-free and browser entries must not need Playwright or opentype.js. */
async function packages(entry: string, kind: 'import-statement' | 'dynamic-import' = 'import-statement'): Promise<string[]> {
  const r = await build({
    entryPoints: [resolve(__dirname, '..', entry)],
    bundle: true,
    write: false,
    splitting: true,
    outdir: 'out',
    metafile: true,
    format: 'esm',
    platform: 'neutral',
    external: ['playwright', 'opentype.js', 'pixelmatch', 'pngjs', 'esbuild', 'node:*'],
    plugins: [{ name: 'skip-build-script', setup: (b) => b.onResolve({ filter: /scripts\/build-inject/ }, () => ({ external: true })) }],
    logLevel: 'silent',
  });
  const main = Object.values(r.metafile.outputs).find((o) => o.entryPoint)!;
  return main.imports.filter((i) => i.kind === kind).map((i) => i.path);
}

describe('package entries', () => {
  it('the root entry needs neither Playwright nor opentype.js', async () => {
    expect(await packages('src/index.ts')).toEqual([]);
  });

  it('the browser entry needs neither Playwright nor opentype.js', async () => {
    expect(await packages('src/backends/browser/index.ts')).toEqual([]);
  });

  it('the node entry names Playwright only; opentype.js loads for outline mode', async () => {
    const imports = await packages('src/node.ts');
    expect(imports).toContain('playwright');
    expect(imports).not.toContain('opentype.js');
    // everything else it names ships as a dependency (diffPatch)
    expect(imports.filter((i) => !['playwright', 'pixelmatch', 'pngjs'].includes(i) && !i.startsWith('node:') && !/build-inject/.test(i))).toEqual([]);
  });

  it('the outline entry names opentype.js only', async () => {
    expect(await packages('src/outline.ts')).toEqual(['opentype.js']);
  });
});
