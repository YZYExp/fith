// Copies real-world benchmark output into the homepage and records its metrics.
//
// Run from the repository root after producing fresh local bench output:
//   pnpm build && pnpm bench:fetch && pnpm bench --local
//   pnpm --dir homepage generate:cases
//
// Library pages (bench/pages/*) are rendered from pinned npm packages, so the
// screenshot and SVG shipped here are an actual fith conversion. Live sites are
// summarised from bench/baseline.json as numbers only; no third-party page
// imagery is redistributed.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const benchOut = `${root}bench/out/`;
const publicDir = fileURLToPath(new URL("../public/cases/", import.meta.url));
const dataFile = fileURLToPath(new URL("../src/cases.json", import.meta.url));

const libraryCases = [
  { id: "lib-github-readme", label: { zh: "GitHub README", en: "GitHub README" }, stack: "github-markdown-css + highlight.js", width: 1100, height: 1500, focus: [0.08, 0.33] },
  { id: "lib-swagger-ui", label: { zh: "Swagger UI", en: "Swagger UI" }, stack: "swagger-ui-dist", width: 1280, height: 1400, focus: [0.1, 0.12] },
  { id: "lib-ag-grid", label: { zh: "AG Grid", en: "AG Grid" }, stack: "ag-grid-community", width: 1280, height: 800, focus: [0.05, 0.1] },
  { id: "lib-antd-showcase", label: { zh: "Ant Design", en: "Ant Design" }, stack: "antd (React)", width: 1280, height: 1300, focus: [0.05, 0.1] },
  { id: "lib-fullcalendar", label: { zh: "FullCalendar", en: "FullCalendar" }, stack: "@fullcalendar/core", width: 1280, height: 900, focus: [0.1, 0.1] },
  { id: "lib-bootstrap-dashboard", label: { zh: "Bootstrap 仪表盘", en: "Bootstrap dashboard" }, stack: "bootstrap", width: 1280, height: 1000, focus: [0.2, 0.1] },
];

// [id, label]; a string label is the same in both languages
const liveSites = [
  ["live-wikipedia", "Wikipedia"],
  ["live-hackernews", "Hacker News"],
  ["live-mdn", "MDN"],
  ["live-reactdev", "react.dev"],
  ["live-stripe", "Stripe"],
  ["live-githubdocs", "GitHub Docs"],
  ["live-pydocs", "Python Docs"],
  ["live-linear", "Linear"],
  ["live-arxiv", "arXiv"],
  ["live-baidu", { zh: "百度", en: "Baidu" }],
];

const report = JSON.parse(await readFile(`${benchOut}report.json`, "utf8"));
const baseline = JSON.parse(await readFile(`${root}bench/baseline.json`, "utf8"));
const byId = new Map(report.map((row) => [row.id, row]));

const metrics = (row) => ({
  diff: row.ratio,
  textCoverage: Math.min(1, row.textCoverage),
  rasterArea: row.rasterAreaFrac,
  svgKB: row.svgKB,
  nodes: row.nodes,
});

await mkdir(publicDir, { recursive: true });
const cases = [];
for (const item of libraryCases) {
  const row = byId.get(item.id);
  if (row?.status !== "ok") throw new Error(`${item.id}: no ok row in bench/out/report.json`);
  for (const ext of ["svg", "expected.png"]) {
    const from = `${benchOut}${item.id}.${ext}`;
    if (!existsSync(from)) throw new Error(`missing ${from}`);
    await copyFile(from, `${publicDir}${item.id}.${ext === "svg" ? "svg" : "png"}`);
  }
  cases.push({ ...item, metrics: metrics(row) });
}

// Live pages that served a bot wall or an empty shell (≤ 20 scene nodes) say
// nothing about fidelity, so they are left out of the summary.
const live = Object.values(baseline).filter(
  (row) => row.id.startsWith("live-") && row.ratio !== undefined && row.nodes > 20,
);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

const data = {
  cases,
  live: {
    count: live.length,
    medianDiff: median(live.map((row) => row.ratio)),
    underOnePercent: live.filter((row) => row.ratio < 0.01).length,
    medianTextCoverage: median(live.map((row) => Math.min(1, row.textCoverage))),
    sites: liveSites.map(([id, label]) => {
      const row = baseline[id];
      if (!row || row.ratio === undefined) throw new Error(`${id}: missing in baseline`);
      return {
        id,
        label: typeof label === "string" ? { zh: label, en: label } : label,
        url: null,
        ...metrics(row),
      };
    }),
  },
};

const corpus = await readFile(`${root}bench/corpus.ts`, "utf8");
for (const site of data.live.sites) {
  site.url = corpus.match(new RegExp(`id: '${site.id}'[^}]*?src: '([^']+)'`))?.[1] ?? null;
}

await writeFile(dataFile, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Copied ${cases.length} library cases and summarised ${live.length} live sites.`);
