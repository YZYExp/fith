import { repositoryUrl } from "../content";
import { useLocale } from "../i18n";

function LanguageSwitch() {
  const { locale, t, setLocale } = useLocale();
  const next = locale === "zh" ? "en" : "zh";
  return (
    <button
      type="button"
      className="lang-switch"
      lang={next === "zh" ? "zh-CN" : "en"}
      aria-label={t.language.switchToLabel}
      onClick={() => setLocale(next)}
    >
      {t.language.switchTo}
    </button>
  );
}

export function Header() {
  const { t } = useLocale();
  return (
    <header className="masthead">
      <a className="brand" href="#main" aria-label={t.brandHome}>
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path
            d="M5 5h22v22H5zM5 12h22M12 12v15M17 17h5M17 22h5"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
        <strong>fith</strong>
      </a>
      <div className="masthead-end">
        <nav className="nav" aria-label={t.nav.label}>
          <a href="#features">{t.nav.features}</a>
          <a href="#cases">{t.nav.cases}</a>
          <a href="#usage">{t.nav.usage}</a>
          <a href="#docs">{t.nav.docs}</a>
        </nav>
        <LanguageSwitch />
      </div>
    </header>
  );
}

export function Footer() {
  const { t } = useLocale();
  return (
    <footer className="footer">
      <div className="wrap">
        <a className="brand" href="#main">
          fith
        </a>
        <p>{t.footer.tagline}</p>
        <a href={repositoryUrl}>GitHub</a>
        <a href="#main">{t.footer.top}</a>
      </div>
    </footer>
  );
}
