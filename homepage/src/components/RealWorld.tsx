import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import cases from "../cases.json";
import { benchCorpusUrl } from "../content";
import { CompareViewer } from "./CompareViewer";

const caseDirectory = `${import.meta.env.BASE_URL}cases/`;

const percent = (value: number, digits = 1) =>
  `${(value * 100).toFixed(digits)}%`;

export function RealWorld() {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = cases.cases[activeIndex];
  const { live } = cases;

  function navigateTabs(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const count = cases.cases.length;
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (index + 1) % count;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    setActiveIndex(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <section className="section cases" id="cases" aria-labelledby="cases-title">
      <div className="section-heading">
        <div>
          <div className="eyebrow">02 / 真实案例</div>
          <h2 id="cases-title">真实的组件库，真实的输出。</h2>
        </div>
        <p>
          以下页面用 npm 上的真实 UI 库搭建，由基准测试直接生成：左边是 Chromium
          截图，右边是 fith 输出的 SVG。
        </p>
      </div>

      <div className="cases-layout">
        <div className="case-list" role="tablist" aria-label="真实案例">
          {cases.cases.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`case-tab-${item.id}`}
              aria-selected={index === activeIndex}
              aria-controls="case-panel"
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => setActiveIndex(index)}
              onKeyDown={(event) => navigateTabs(event, index)}
            >
              <strong>{item.label}</strong>
              <span>{item.stack}</span>
            </button>
          ))}
        </div>

        <div
          className="case-panel"
          id="case-panel"
          role="tabpanel"
          aria-labelledby={`case-tab-${active.id}`}
        >
          <dl className="case-metrics">
            <div>
              <dt>像素差异</dt>
              <dd>{percent(active.metrics.diff, 2)}</dd>
            </div>
            <div>
              <dt>矢量文字</dt>
              <dd>{percent(active.metrics.textCoverage, 0)}</dd>
            </div>
            <div>
              <dt>栅格面积</dt>
              <dd>{percent(active.metrics.rasterArea, 1)}</dd>
            </div>
            <div>
              <dt>SVG 大小</dt>
              <dd>{active.metrics.svgKB} KB</dd>
            </div>
          </dl>
          <CompareViewer
            before={`${caseDirectory}${active.id}.png`}
            after={`${caseDirectory}${active.id}.svg`}
            width={active.width}
            height={active.height}
            focus={active.focus as [number, number]}
            label={active.label}
          />
          <div className="case-links">
            <span>
              {active.width}×{active.height} · 字体内嵌（embed）
            </span>
            <a
              href={`${caseDirectory}${active.id}.svg`}
              target="_blank"
              rel="noopener"
            >
              单独打开 SVG
            </a>
          </div>
        </div>
      </div>

      <div className="live-sites">
        <div className="live-summary">
          <h3>也跑在线上网站</h3>
          <p>
            基准测试同样转换 {live.count} 个线上站点。像素差异中位数{" "}
            <strong>{percent(live.medianDiff, 2)}</strong>，其中{" "}
            <strong>{live.underOnePercent}</strong> 个低于 1%；矢量文字覆盖中位数{" "}
            <strong>{percent(live.medianTextCoverage, 0)}</strong>。
          </p>
          <p className="live-note">
            线上页面随时间变化，数据取自最近一次基准记录；被拦截或返回空壳的站点不计入。
          </p>
          <a href={benchCorpusUrl}>查看完整基准结果</a>
        </div>
        <div className="table-scroll" tabIndex={0} aria-label="线上站点基准数据">
          <table>
            <thead>
              <tr>
                <th scope="col">站点</th>
                <th scope="col">像素差异</th>
                <th scope="col">矢量文字</th>
                <th scope="col">栅格面积</th>
              </tr>
            </thead>
            <tbody>
              {live.sites.map((site) => (
                <tr key={site.id}>
                  <th scope="row">
                    {site.url ? <a href={site.url}>{site.label}</a> : site.label}
                  </th>
                  <td>{percent(site.diff, 2)}</td>
                  <td>{percent(site.textCoverage, 0)}</td>
                  <td>{percent(site.rasterArea, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
