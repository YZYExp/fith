import { repositoryUrl } from "../content";
import { useLocale } from "../i18n";

export function ProjectQuestions() {
  const { t } = useLocale();
  return (
    <section
      className="section questions"
      id="questions"
      aria-labelledby="questions-title"
    >
      <div>
        <div className="eyebrow">{t.questions.eyebrow}</div>
        <h2 id="questions-title">{t.questions.title}</h2>
        <p>{t.questions.intro}</p>
      </div>
      <div className="faq">
        {t.questions.items.map((question, index) => (
          <details key={question.title} open={index === 0}>
            <summary>{question.title}</summary>
            <p>{question.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function Documentation() {
  const { t } = useLocale();
  return (
    <section className="documentation" id="docs" aria-labelledby="docs-title">
      <div className="eyebrow">{t.docs.eyebrow}</div>
      <div>
        <h2 id="docs-title">{t.docs.title}</h2>
        <p>{t.docs.text}</p>
        <div className="doc-links">
          <a href={t.readmeUrl}>{t.docs.readme}</a>
          <a href={`${repositoryUrl}/blob/main/DESIGN.md`}>{t.docs.design}</a>
          <a href={`${repositoryUrl}/issues`}>{t.docs.issues}</a>
        </div>
      </div>
    </section>
  );
}
