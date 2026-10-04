import { features } from "../content";

function FeatureIcon({ kind }: { kind: (typeof features)[number]["id"] }) {
  return (
    <svg viewBox="0 0 180 120" fill="none" aria-hidden="true">
      {kind === "layout" && (
        <>
          <rect x="24" y="15" width="132" height="90" rx="3" />
          <path d="M24 35h132M41 50h50M41 60h63M41 75h42M41 86h56" />
          <rect x="117" y="50" width="23" height="36" />
        </>
      )}
      {kind === "file" && (
        <>
          <path d="M58 13h47l24 24v70H58zM105 13v24h24" />
          <path d="M71 68h9l8-18 9 33 8-15h11" />
          <circle cx="80" cy="44" r="3" />
        </>
      )}
      {kind === "fallback" && (
        <>
          <rect x="25" y="19" width="130" height="82" rx="3" />
          <path d="M39 81c18-43 42-50 59-11s30 22 43-29" />
          <rect
            x="109"
            y="35"
            width="30"
            height="30"
            fill="currentColor"
            opacity=".12"
          />
          <path
            d="M109 35h30v30h-30zM119 35v30M129 35v30M109 45h30M109 55h30"
            strokeDasharray="2 3"
          />
        </>
      )}
    </svg>
  );
}

export function Features() {
  return (
    <section className="section" id="features" aria-labelledby="features-title">
      <div className="section-heading">
        <div>
          <div className="eyebrow">01 / 转换能力</div>
          <h2 id="features-title">为页面，保留表达力。</h2>
        </div>
        <p>从页面里的 DOM 与 CSS，到一份可以独立查看和交付的 SVG。</p>
      </div>
      <div className="cards">
        {features.map((feature) => (
          <article className="card" key={feature.id}>
            <div className="card-art">
              <FeatureIcon kind={feature.id} />
            </div>
            <div className="eyebrow">
              {feature.number} / {feature.label}
            </div>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
