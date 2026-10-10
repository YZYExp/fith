import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { readmeUrl, setupCommand, usageExamples } from "../content";

function CodeBlock({ code, filename }: { code: string; filename: string }) {
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
        <button type="button" onClick={copyCode} aria-label="复制当前示例代码">
          {copyState === "copied" ? "已复制" : "复制代码"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
      <span className="copy-status" role="status">
        {copyState === "copied"
          ? "代码已复制到剪贴板。"
          : copyState === "failed"
            ? "复制失败，请手动选择代码。"
            : ""}
      </span>
    </div>
  );
}

export function Usage() {
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
            <div className="eyebrow">03 / 开始使用</div>
            <h2 id="usage-title">四种入口，同一个捕获核心。</h2>
          </div>
          <p>从自动化脚本到浏览器操作，选择适合你的使用方式。</p>
        </div>
        <div
          className="usage-tabs"
          role="tablist"
          aria-label="fith 使用方式"
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
            <h3>从仓库开始</h3>
            <p>项目要求 Node.js ≥ 18。先安装依赖与浏览器，再构建库。</p>
            <pre>
              <code>{setupCommand}</code>
            </pre>
            <a href={readmeUrl}>查看完整安装与使用说明</a>
          </aside>
        </div>
      </div>
    </section>
  );
}
