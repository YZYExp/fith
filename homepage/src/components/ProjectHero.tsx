import { repositoryUrl } from "../content";
import { CompareViewer } from "./CompareViewer";

const exampleDirectory = `${import.meta.env.BASE_URL}examples/`;

export function ProjectHero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <div className="eyebrow">HTML → SVG · fith</div>
        <h1 id="hero-title">
          把 HTML，
          <br />
          变成 <em>SVG。</em>
        </h1>
        <p className="intro">
          将网页或单个元素转换为自包含的
          SVG。保留浏览器计算后的布局，让文字、图形和页面细节进入同一份文件。
        </p>
        <div className="actions">
          <a className="button" href="#usage">
            开始使用
          </a>
          <a className="text-link" href="#cases">
            看真实案例
          </a>
          <a className="text-link" href={repositoryUrl}>
            GitHub 项目
          </a>
        </div>
        <p className="hero-meta">Node API / CLI / 页内库 / Chrome 扩展</p>
      </div>
      <div className="export-preview" aria-label="fith 的真实转换示例">
        <div className="preview-head">
          <span className="file-label">card.html → card.svg</span>
          <a href={`${exampleDirectory}card.svg`} download="fith-card.svg">
            下载 SVG
          </a>
        </div>
        <CompareViewer
          before={`${exampleDirectory}card.png`}
          after={`${exampleDirectory}card.svg`}
          width={520}
          height={360}
          focus={[0.72, 0.4]}
          label="示例卡片"
        />
      </div>
    </section>
  );
}

export function ProjectPrinciple() {
  return (
    <section className="principle" aria-labelledby="principle-title">
      <h2 className="eyebrow" id="principle-title">
        项目的核心
      </h2>
      <p>
        浏览器负责布局，fith 负责转换。
        <br />
        以向量表达页面，对复杂效果保留局部截图回退。
      </p>
    </section>
  );
}
