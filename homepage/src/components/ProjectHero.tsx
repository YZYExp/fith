import { repositoryUrl } from "../content";
import { useLocale } from "../i18n";
import { CompareViewer } from "./CompareViewer";

const exampleDirectory = `${import.meta.env.BASE_URL}examples/`;

export function ProjectHero() {
  const { t } = useLocale();
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <div className="eyebrow">HTML → SVG · fith</div>
        <h1 id="hero-title">
          {t.hero.titleLine1}
          <br />
          {t.hero.titleLine2(<em>{t.hero.titleEm}</em>)}
        </h1>
        <p className="intro">{t.hero.intro}</p>
        <div className="actions">
          <a className="button" href="#usage">
            {t.hero.start}
          </a>
          <a className="text-link" href="#cases">
            {t.hero.cases}
          </a>
          <a className="text-link" href={repositoryUrl}>
            {t.hero.github}
          </a>
        </div>
        <p className="hero-meta">{t.hero.meta}</p>
      </div>
      <div className="export-preview" aria-label={t.hero.previewLabel}>
        <div className="preview-head">
          <span className="file-label">card.html → card.svg</span>
          <a href={`${exampleDirectory}card.svg`} download="fith-card.svg">
            {t.hero.download}
          </a>
        </div>
        <CompareViewer
          before={`${exampleDirectory}card.png`}
          after={`${exampleDirectory}card.svg`}
          width={520}
          height={360}
          focus={[0.72, 0.4]}
          label={t.hero.exampleLabel}
        />
      </div>
    </section>
  );
}

export function ProjectPrinciple() {
  const { t } = useLocale();
  return (
    <section className="principle" aria-labelledby="principle-title">
      <h2 className="eyebrow" id="principle-title">
        {t.principle.title}
      </h2>
      <p>
        {t.principle.line1}
        <br />
        {t.principle.line2}
      </p>
    </section>
  );
}
