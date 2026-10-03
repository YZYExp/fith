export function Questions() {
  return (
    <section
      className="section questions"
      id="questions"
      aria-labelledby="questions-title"
    >
      <div>
        <div className="eyebrow">03 / Open questions</div>
        <h2 id="questions-title">
          The loop is simple.
          <br />
          The implications aren’t.
        </h2>
        <p>
          The pace, limits, and governance of AI-assisted research remain open
          questions.
        </p>
      </div>
      <div className="faq">
        <details open>
          <summary>Is this the same as an intelligence explosion?</summary>
          <p>
            No. Recursive self-improvement describes a feedback mechanism. An
            intelligence explosion is a possible outcome involving very rapid
            growth in capabilities. Establishing a loop does not establish how
            quickly it will compound.
          </p>
        </details>
        <details>
          <summary>Does AI rewrite itself autonomously?</summary>
          <p>
            It need not. The feedback can run through human researchers,
            training infrastructure, and experimental pipelines. The defining
            feature is that AI contributes to improvements in subsequent AI
            systems.
          </p>
        </details>
        <details>
          <summary>What could slow the process down?</summary>
          <p>
            Ideas must survive testing, and testing takes resources. Hardware
            supply, training costs, experiment duration, access to useful data,
            and difficulty measuring progress can all constrain the cycle.
          </p>
        </details>
        <details>
          <summary>What would we need to measure?</summary>
          <p>
            Useful evidence would include the quality of AI research
            contributions, the time saved on validated discoveries, and whether
            those discoveries improve future systems. Safety evaluations also
            need to keep pace with capability changes.
          </p>
        </details>
      </div>
    </section>
  );
}

export function Reading() {
  return (
    <section
      className="source-section"
      id="reading"
      aria-labelledby="reading-title"
    >
      <div className="eyebrow">Keep exploring</div>
      <div>
        <h2 id="reading-title">Go to the source.</h2>
        <p>
          Read Anthropic’s Institute article on recursive self-improvement for
          its discussion of the topic. This field guide is an independent
          introduction.
        </p>
        <a
          className="text-link"
          href="https://www.anthropic.com/institute/recursive-self-improvement"
        >
          Recursive self-improvement · Anthropic Institute
        </a>
      </div>
    </section>
  );
}
