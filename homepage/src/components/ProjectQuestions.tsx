import { questions, readmeUrl, repositoryUrl } from "../content";

export function ProjectQuestions() {
  return (
    <section
      className="section questions"
      id="questions"
      aria-labelledby="questions-title"
    >
      <div>
        <div className="eyebrow">04 / 输出与边界</div>
        <h2 id="questions-title">
          了解输出，
          <br />
          也了解边界。
        </h2>
        <p>字体模式、栅格回退和验证方式，决定了结果如何呈现。</p>
      </div>
      <div className="faq">
        {questions.map((question, index) => (
          <details key={question.title} open={index === 0}>
            <summary>{question.title}</summary>
            <p>{question.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function Documentation() {
  return (
    <section className="documentation" id="docs" aria-labelledby="docs-title">
      <div className="eyebrow">项目文档</div>
      <div>
        <h2 id="docs-title">从一个页面，开始转换。</h2>
        <p>
          在 README 中查看配置、扩展加载方式与验证命令，或了解 DOM 捕获到 SVG
          输出的设计。
        </p>
        <div className="doc-links">
          <a href={readmeUrl}>使用文档</a>
          <a href={`${repositoryUrl}/blob/main/DESIGN.md`}>架构设计</a>
          <a href={`${repositoryUrl}/issues`}>反馈问题</a>
        </div>
      </div>
    </section>
  );
}
