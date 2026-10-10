import { Header, Footer } from "./components/Layout";
import { ProjectHero, ProjectPrinciple } from "./components/ProjectHero";
import { Features } from "./components/Features";
import { RealWorld } from "./components/RealWorld";
import { Usage } from "./components/Usage";
import { ProjectQuestions, Documentation } from "./components/ProjectQuestions";
import { useLocale } from "./i18n";

export default function App() {
  const { t } = useLocale();
  return (
    <>
      <a className="skip" href="#main">
        {t.skip}
      </a>
      <div className="wrap">
        <Header />
      </div>
      <main id="main">
        <div className="wrap">
          <ProjectHero />
          <ProjectPrinciple />
          <Features />
          <RealWorld />
        </div>
        <Usage />
        <div className="wrap">
          <ProjectQuestions />
          <Documentation />
        </div>
      </main>
      <Footer />
    </>
  );
}
