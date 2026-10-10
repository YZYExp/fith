import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import cases from "../cases.json";
import { benchCorpusUrl } from "../content";
import { useLocale } from "../i18n";
import { CompareViewer } from "./CompareViewer";

const caseDirectory = `${import.meta.env.BASE_URL}cases/`;

const percent = (value: number, digits = 1) =>
  `${(value * 100).toFixed(digits)}%`;

export function RealWorld() {
  const { locale, t } = useLocale();
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
          <div className="eyebrow">{t.cases.eyebrow}</div>
          <h2 id="cases-title">{t.cases.title}</h2>
        </div>
        <p>{t.cases.intro}</p>
      </div>

      <div className="cases-layout">
        <div className="case-list" role="tablist" aria-label={t.cases.tablist}>
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
              <strong>{item.label[locale]}</strong>
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
              <dt>{t.cases.diff}</dt>
              <dd>{percent(active.metrics.diff, 2)}</dd>
            </div>
            <div>
              <dt>{t.cases.text}</dt>
              <dd>{percent(active.metrics.textCoverage, 0)}</dd>
            </div>
            <div>
              <dt>{t.cases.raster}</dt>
              <dd>{percent(active.metrics.rasterArea, 1)}</dd>
            </div>
            <div>
              <dt>{t.cases.size}</dt>
              <dd>{active.metrics.svgKB} KB</dd>
            </div>
          </dl>
          <CompareViewer
            before={`${caseDirectory}${active.id}.png`}
            after={`${caseDirectory}${active.id}.svg`}
            width={active.width}
            height={active.height}
            focus={active.focus as [number, number]}
            label={active.label[locale]}
          />
          <div className="case-links">
            <span>
              {active.width}×{active.height} · {t.cases.embed}
            </span>
            <a
              href={`${caseDirectory}${active.id}.svg`}
              target="_blank"
              rel="noopener"
            >
              {t.cases.openSvg}
            </a>
          </div>
        </div>
      </div>

      <div className="live-sites">
        <div className="live-summary">
          <h3>{t.cases.liveTitle}</h3>
          <p>{t.cases.liveSummary(live)}</p>
          <p className="live-note">{t.cases.liveNote}</p>
          <a href={benchCorpusUrl}>{t.cases.liveLink}</a>
        </div>
        <div className="table-scroll" tabIndex={0} aria-label={t.cases.tableLabel}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t.cases.site}</th>
                <th scope="col">{t.cases.diff}</th>
                <th scope="col">{t.cases.text}</th>
                <th scope="col">{t.cases.raster}</th>
              </tr>
            </thead>
            <tbody>
              {live.sites.map((site) => (
                <tr key={site.id}>
                  <th scope="row">
                    {site.url ? (
                      <a href={site.url}>{site.label[locale]}</a>
                    ) : (
                      site.label[locale]
                    )}
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
