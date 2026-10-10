import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { setupCommand } from "../content";
import { useLocale } from "../i18n";

function CodeBlock({ code, filename }: { code: string; filename: string }) {
  const { t } = useLocale();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>{filename}</span>
        <button type="button" onClick={copyCode} aria-label={t.usage.copyAria}>
          {copyState === "copied" ? t.usage.copied : t.usage.copy}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
      <span className="copy-status" role="status">
        {copyState === "copied"
          ? t.usage.copiedStatus
          : copyState === "failed"
            ? t.usage.copyFailed
            : ""}
      </span>
    </div>
  );
}

export function Usage() {
  const { t } = useLocale();
  const usageExamples = t.usage.examples;
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function navigateTabs(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex = index;
    if (event.key === "ArrowRight")
      nextIndex = (index + 1) % usageExamples.length;
    else if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + usageExamples.length) % usageExamples.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = usageExamples.length - 1;
    else return;
    event.preventDefault();
    setActiveIndex(nextIndex);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section className="usage-section" id="usage" aria-labelledby="usage-title">
      <div className="wrap">
        <div className="section-heading">
          <div>
            <div className="eyebrow">{t.usage.eyebrow}</div>
            <h2 id="usage-title">{t.usage.title}</h2>
          </div>
          <p>{t.usage.intro}</p>
        </div>
        <div
          className="usage-tabs"
          role="tablist"
          aria-label={t.usage.tablist}
        >
          {usageExamples.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={index === activeIndex}
              aria-controls={`panel-${item.id}`}
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => setActiveIndex(index)}
              onKeyDown={(event) => navigateTabs(event, index)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="usage-layout">
          <div className="usage-content">
            {usageExamples.map((example, index) => (
              <div
                key={example.id}
                className="usage-panel"
                role="tabpanel"
                id={`panel-${example.id}`}
                aria-labelledby={`tab-${example.id}`}
                hidden={index !== activeIndex}
                tabIndex={0}
              >
                <p className="usage-description">{example.description}</p>
                <CodeBlock filename={example.filename} code={example.code} />
                <p className="usage-note">{example.note}</p>
              </div>
            ))}
          </div>
          <aside className="setup">
            <h3>{t.usage.setupTitle}</h3>
            <p>{t.usage.setupText}</p>
            <pre>
              <code>{setupCommand}</code>
            </pre>
            <a href={t.readmeUrl}>{t.usage.setupLink}</a>
          </aside>
        </div>
      </div>
    </section>
  );
}
