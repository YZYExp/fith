/**
 * Benchmark runner: `pnpm bench [--only id,id] [--live|--local] [--update-baseline]`
 * Writes bench/out/report.{json,md} (+ per-target svg/png/diff) and compares
 * against bench/baseline.json, flagging regressions.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { validate, serveDir } from '../scripts/validate.js';
import { CORPUS, type Target } from './corpus.js';

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const wantLive = !argv.includes('--local');
const wantLocal = !argv.includes('--live');
const update = argv.includes('--update-baseline');
const OUT = resolve('bench/out');
const BASELINE = resolve('bench/baseline.json');

interface Row {
  id: string; status: 'ok' | 'regress' | 'skip' | 'error'; ratio?: number; contentRatio?: number; worstTile?: number; textCoverage?: number;
  rasterAreaFrac?: number; raster?: number; nodes?: number; svgKB?: number; ms?: number; note?: string;
}

async function runOne(t: Target, base: string): Promise<Row> {
  const local = t.kind === 'local';
  const file = resolve('bench/pages', t.src);
  if (local && !existsSync(file)) return { id: t.id, status: 'skip', note: 'page missing (run pnpm bench:fetch)' };
  try {
    const r = await validate({ url: local ? base + 'pages/' + t.src : t.src }, {
      width: t.width, height: t.height, name: t.id, outDir: OUT, settleMs: t.settleMs, fontMode: 'embed',
    });
    const cov = r.stats.domTextChars ? r.stats.textChars / r.stats.domTextChars : 1;
    const rasterFrac = r.stats.rasterArea / (r.width * r.height);
    const fails: string[] = [];
    if (r.ratio > t.maxRatio) fails.push(`diff ${(r.ratio * 100).toFixed(2)}% > ${(t.maxRatio * 100).toFixed(1)}%`);
    if (t.minTextCoverage && cov < t.minTextCoverage) fails.push(`text coverage ${(cov * 100).toFixed(0)}% < ${(t.minTextCoverage * 100).toFixed(0)}%`);
    if (t.maxRasterArea !== undefined && rasterFrac > t.maxRasterArea) fails.push(`raster ${(rasterFrac * 100).toFixed(0)}% > ${(t.maxRasterArea * 100).toFixed(0)}%`);
    return { id: t.id, status: fails.length ? 'regress' : 'ok', ratio: r.ratio, contentRatio: r.contentRatio, worstTile: r.worstTile, textCoverage: cov, rasterAreaFrac: rasterFrac,
      raster: r.stats.raster, nodes: r.stats.nodes, svgKB: Math.round(r.svgBytes / 1024), ms: r.captureMs, note: fails.join('; ') || JSON.stringify(r.stats.rasterReasons) };
  } catch (e: any) {
    const msg = String(e?.message || e).split('\n')[0].slice(0, 120);
    return { id: t.id, status: t.kind === 'live' && /net::|Timeout/.test(msg) ? 'skip' : 'error', note: msg };
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const targets = CORPUS.filter((t) => (only ? only.includes(t.id) : t.kind === 'live' ? wantLive : wantLocal));
  const base: Record<string, Row> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
  const rows: Row[] = [];
  // local pages are served over http: fetch() of fonts/images from file:// is blocked by Chromium
  const server = await serveDir(resolve('bench'));
  for (const t of targets) {
    const row = await runOne(t, server.url);
    const b = base[t.id];
    if (b?.ratio !== undefined && row.ratio !== undefined && row.ratio > Math.max(b.ratio * 1.5, b.ratio + 0.002) && row.status === 'ok') { row.status = 'regress'; row.note = `vs baseline ${(b.ratio * 100).toFixed(2)}%`; }
    rows.push(row);
    console.error(`${row.status.padEnd(7)} ${t.id.padEnd(22)} ${row.ratio !== undefined ? (row.ratio * 100).toFixed(2) + '%' : '-'}  ${row.note ?? ''}`);
  }
  await server.close();
  const md = ['| target | status | diff | content diff | worst tile | text cov | raster area | raster# | nodes | svg KB | ms |', '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${r.status} | ${r.ratio !== undefined ? (r.ratio * 100).toFixed(2) + '%' : '-'} | ${r.contentRatio !== undefined ? (r.contentRatio * 100).toFixed(1) + '%' : '-'} | ${r.worstTile !== undefined ? (r.worstTile * 100).toFixed(0) + '%' : '-'} | ${r.textCoverage !== undefined ? (r.textCoverage * 100).toFixed(0) + '%' : '-'} | ${r.rasterAreaFrac !== undefined ? (r.rasterAreaFrac * 100).toFixed(0) + '%' : '-'} | ${r.raster ?? '-'} | ${r.nodes ?? '-'} | ${r.svgKB ?? '-'} | ${r.ms ?? '-'} |`)].join('\n');
  writeFileSync(join(OUT, 'report.md'), md + '\n');
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
  if (update) {
    const nb = { ...base };
    for (const r of rows) if (r.status === 'ok' || r.status === 'regress') nb[r.id] = r;
    writeFileSync(BASELINE, JSON.stringify(nb, null, 2) + '\n');
  }
  console.log(md);
  if (rows.some((r) => r.status === 'regress' || r.status === 'error')) process.exitCode = 1;
}
main();
