/**
 * Pull the real third-party UI libraries used by bench/pages/*.html from the npm
 * registry into bench/.cache (gitignored). Versions are pinned for reproducibility.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const PACKAGES = [
  'bootstrap@5.3.3', 'bootstrap-icons@1.11.3', 'tailwindcss@2.2.19', 'daisyui@4.12.2', 'bulma@1.0.1',
  '@fortawesome/fontawesome-free@6.5.2', 'github-markdown-css@5.6.1', 'marked@12.0.2', '@highlightjs/cdn-assets@11.9.0',
  'swagger-ui-dist@5.17.14', 'katex@0.16.10', 'mermaid@10.9.1', 'echarts@5.5.0', 'chart.js@4.4.2',
  'ag-grid-community@31.2.1', 'fullcalendar@6.1.11', 'leaflet@1.9.4', 'reveal.js@5.1.0', 'quill@1.3.7',
  'react@18.3.1', 'react-dom@18.3.1', 'antd@5.17.0', 'dayjs@1.11.10',
];

const dir = resolve('bench/.cache');
mkdirSync(dir, { recursive: true });
if (!existsSync(resolve(dir, 'package.json'))) writeFileSync(resolve(dir, 'package.json'), '{"name":"bench-cache","private":true}');
execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', ...PACKAGES], { cwd: dir, stdio: 'inherit' });
console.error(`fetched ${PACKAGES.length} packages into ${dir}`);
