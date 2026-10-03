import { OrbitIllustration } from "./OrbitIllustration";

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div>
        <div className="eyebrow">Field notes on artificial intelligence</div>
        <h1 id="hero-title">
          When AI helps
          <br />
          build the
          <br />
          <em>next AI.</em>
        </h1>
        <p className="intro">
          A field guide to recursive self-improvement—and what happens when the
          tools of discovery become part of the discovery process.
        </p>
        <div className="actions">
          <a className="button" href="#ideas">
            Explore the idea
          </a>
          <a
            className="text-link"
            href="https://www.anthropic.com/institute/recursive-self-improvement"
          >
            Read the original article
          </a>
        </div>
      </div>
      <div className="hero-art">
        <OrbitIllustration />
        <p className="art-note">
          Research → capability → research
          <br />A conceptual feedback loop
        </p>
      </div>
    </section>
  );
}

export function CentralIdea() {
  return (
    <section className="abstract" aria-labelledby="central-idea">
      <h2 className="eyebrow" id="central-idea">
        The central idea
      </h2>
      <p>
        An AI system improves the process that creates future AI systems. If
        those improvements make the next system a better researcher, the cycle
        can begin again.
      </p>
    </section>
  );
}
