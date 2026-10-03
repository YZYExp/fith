import { Header, Footer } from "./components/Layout";
import { Hero, CentralIdea } from "./components/Hero";
import { Foundations } from "./components/Foundations";
import { FeedbackLoop } from "./components/FeedbackLoop";
import { Questions, Reading } from "./components/Questions";

export default function App() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="wrap">
        <Header />
      </div>
      <main id="main">
        <div className="wrap">
          <Hero />
          <CentralIdea />
          <Foundations />
        </div>
        <FeedbackLoop />
        <div className="wrap">
          <Questions />
          <Reading />
        </div>
      </main>
      <Footer />
    </>
  );
}
