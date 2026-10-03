import { useState } from "react";
import { repositoryUrl } from "../content";

const exampleDirectory = `${import.meta.env.BASE_URL}examples/`;

export function ProjectHero() {
  const [format, setFormat] = useState<"svg" | "png">("svg");
  const [zoom, setZoom] = useState(1);

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <div className="eyebrow">HTML → SVG · fitting-html</div>
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
          <a className="text-link" href={repositoryUrl}>
            查看 GitHub 项目
          </a>
        </div>
        <p className="hero-meta">Node API / CLI / 页内库 / Chrome 扩展</p>
      </div>
      <div className="export-preview" aria-label="fitting-html 的真实转换示例">
        <div className="preview-toolbar">
          <span className="file-label">
            {format === "svg" ? "card.svg" : "card.png"}
          </span>
          <div className="segmented" role="group" aria-label="选择示例格式">
            <button
              type="button"
              aria-pressed={format === "png"}
              onClick={() => setFormat("png")}
            >
              网页截图
            </button>
            <button
              type="button"
              aria-pressed={format === "svg"}
              onClick={() => setFormat("svg")}
            >
              SVG 输出
            </button>
          </div>
        </div>
        <div className="render-stage">
          <img
            src={`${exampleDirectory}card.${format}`}
            alt={
              format === "svg"
                ? "由 fitting-html 转换生成的示例 SVG"
                : "同一示例 HTML 的浏览器截图"
            }
            width="520"
            height="360"
            style={{ transform: `scale(${zoom})` }}
          />
        </div>
        <div className="preview-bottom">
          <span>真实转换 · 字体转路径</span>
          <div className="segmented" role="group" aria-label="示例缩放比例">
            {[1, 3].map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={zoom === value}
                onClick={() => setZoom(value)}
              >
                {value}×
              </button>
            ))}
          </div>
        </div>
        <div className="preview-caption">
          <p>用项目的 htmlToSvg API 生成，切换格式或放大查看。</p>
          <a
            href={`${exampleDirectory}card.svg`}
            download="fitting-html-card.svg"
          >
            下载 SVG
          </a>
        </div>
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
        浏览器负责布局，fitting-html 负责转换。
        <br />
        以向量表达页面，对复杂效果保留局部截图回退。
      </p>
    </section>
  );
}
