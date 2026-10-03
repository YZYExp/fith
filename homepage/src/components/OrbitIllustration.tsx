export function OrbitIllustration() {
  return (
    <svg viewBox="0 0 520 510" role="img" aria-labelledby="art-title art-desc">
      <title id="art-title">An unfolding feedback loop</title>
      <desc id="art-desc">
        Overlapping elliptical loops surround a shared center, illustrating
        successive cycles of improvement.
      </desc>
      <defs>
        <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".8" fill="#90998a" opacity=".5" />
        </pattern>
      </defs>
      <rect x="22" y="12" width="476" height="476" fill="url(#grid)" />
      <path
        d="M22 250h476M260 12v476"
        stroke="#a8afa0"
        strokeWidth=".7"
        opacity=".6"
      />
      <g className="orbit" fill="none" stroke="#435c43" strokeWidth="1.35">
        <ellipse
          cx="260"
          cy="250"
          rx="210"
          ry="118"
          transform="rotate(-65 260 250)"
        />
        <ellipse
          cx="260"
          cy="250"
          rx="202"
          ry="112"
          transform="rotate(-48 260 250)"
        />
        <ellipse
          cx="260"
          cy="250"
          rx="194"
          ry="106"
          transform="rotate(-31 260 250)"
        />
        <ellipse
          cx="260"
          cy="250"
          rx="186"
          ry="100"
          transform="rotate(-14 260 250)"
        />
        <ellipse
          cx="260"
          cy="250"
          rx="178"
          ry="94"
          transform="rotate(3 260 250)"
        />
        <ellipse
          cx="260"
          cy="250"
          rx="170"
          ry="88"
          transform="rotate(20 260 250)"
        />
        <ellipse
          cx="260"
          cy="250"
          rx="162"
          ry="82"
          transform="rotate(37 260 250)"
        />
        <ellipse
          cx="260"
          cy="250"
          rx="154"
          ry="76"
          transform="rotate(54 260 250)"
        />
        <ellipse
          cx="260"
          cy="250"
          rx="146"
          ry="70"
          transform="rotate(71 260 250)"
        />
        <ellipse
          cx="260"
          cy="250"
          rx="138"
          ry="64"
          transform="rotate(88 260 250)"
        />
        <ellipse
          cx="260"
          cy="250"
          rx="130"
          ry="58"
          transform="rotate(105 260 250)"
        />
        <ellipse
          cx="260"
          cy="250"
          rx="122"
          ry="52"
          transform="rotate(122 260 250)"
        />
      </g>
      <circle cx="260" cy="250" r="4" fill="#334c3b" />
      <g fontFamily="monospace" fontSize="11" fill="#60665d">
        <text x="32" y="31">
          FIG. 01
        </text>
        <text x="394" y="31">
          ITERATION / n+1
        </text>
      </g>
    </svg>
  );
}
