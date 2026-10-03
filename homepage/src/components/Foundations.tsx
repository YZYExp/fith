export function Foundations() {
  return (
    <section className="section" id="ideas" aria-labelledby="ideas-title">
      <div className="section-heading">
        <div>
          <div className="eyebrow">01 / Foundations</div>
          <h2 id="ideas-title">Three ideas to start with.</h2>
        </div>
        <p>
          Understand the mechanism before making predictions about the outcome.
        </p>
      </div>
      <div className="cards">
        <article className="card">
          <div className="card-art">
            <svg viewBox="0 0 180 120" fill="none" aria-hidden="true">
              <rect x="27" y="47" width="38" height="45" stroke="#435c43" />
              <rect x="70" y="33" width="38" height="59" stroke="#435c43" />
              <rect x="113" y="19" width="38" height="73" stroke="#435c43" />
              <path
                d="M20 98h138M46 41V29h87"
                stroke="#435c43"
                strokeDasharray="3 4"
              />
              <circle cx="133" cy="29" r="3" fill="#435c43" />
            </svg>
          </div>
          <div className="eyebrow">01 — Capability</div>
          <h3>AI as a research tool</h3>
          <p>
            AI can assist with coding, experiments, and analysis. The relevant
            question is how much useful research it can do, and how reliably it
            can do it.
          </p>
        </article>
        <article className="card">
          <div className="card-art">
            <svg viewBox="0 0 180 120" fill="none" aria-hidden="true">
              <circle cx="90" cy="60" r="42" stroke="#435c43" />
              <circle cx="90" cy="60" r="28" stroke="#435c43" />
              <circle cx="90" cy="60" r="14" stroke="#435c43" />
              <path
                d="M90 11v20M139 60h-20M90 109V89M41 60h20"
                stroke="#435c43"
                strokeWidth="2"
              />
              <circle cx="90" cy="60" r="3" fill="#435c43" />
            </svg>
          </div>
          <div className="eyebrow">02 — Feedback</div>
          <h3>Better tools, better tools</h3>
          <p>
            When AI-assisted research improves AI itself, the output feeds back
            into the process. Each new generation may help develop the one that
            follows.
          </p>
        </article>
        <article className="card">
          <div className="card-art">
            <svg viewBox="0 0 180 120" fill="none" aria-hidden="true">
              <path
                d="M25 94h130M31 99V20M38 87c24 0 29-8 40-17s25-13 38-23 16-19 25-28"
                stroke="#665740"
                strokeWidth="1.5"
              />
              <path
                d="M38 87c28 0 43-4 61-8s32-5 45-6"
                stroke="#665740"
                strokeDasharray="4 4"
              />
              <circle cx="105" cy="56" r="4" fill="#665740" />
              <path d="M105 60v31" stroke="#665740" strokeDasharray="2 3" />
            </svg>
          </div>
          <div className="eyebrow">03 — Constraints</div>
          <h3>Feedback meets friction</h3>
          <p>
            Compute, data, experiments, and human oversight still matter. A
            feedback loop can accelerate progress without guaranteeing unlimited
            improvement.
          </p>
        </article>
      </div>
    </section>
  );
}
