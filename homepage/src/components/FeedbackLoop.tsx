import { useState } from "react";
import { stages } from "../content";

export function FeedbackLoop() {
  const [activeIndex, setActiveIndex] = useState(0);
  const stage = stages[activeIndex];

  return (
    <section className="loop-section" id="loop" aria-labelledby="loop-title">
      <div className="wrap">
        <div className="section-heading">
          <div>
            <div className="eyebrow">02 / The mechanism</div>
            <h2 id="loop-title">Inside the feedback loop.</h2>
          </div>
          <p>Select a stage to see how one cycle could inform the next.</p>
        </div>
        <div className="loop-layout">
          <div
            className="steps"
            role="group"
            aria-label="Stages of recursive self-improvement"
          >
            {stages.map((item, index) => (
              <button
                className="step"
                type="button"
                key={item.name}
                aria-pressed={index === activeIndex}
                aria-controls="stage-panel"
                onClick={() => setActiveIndex(index)}
              >
                <span className="number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="name">{item.name}</span>
                <span className="active-label" aria-hidden="true">
                  SELECTED
                </span>
              </button>
            ))}
          </div>
          <div
            className="step-panel"
            id="stage-panel"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="stage-label" id="stage-label">
              STAGE {String(activeIndex + 1).padStart(2, "0")} /{" "}
              {stage.name.toUpperCase()}
            </div>
            <h3 id="stage-title">{stage.title}</h3>
            <p id="stage-copy">{stage.description}</p>
            <p className="example" id="stage-example">
              {stage.example}
            </p>
          </div>
        </div>
        <p className="loop-footnote">
          A conceptual model of the process, not a forecast of its speed or
          outcome.
        </p>
      </div>
    </section>
  );
}
