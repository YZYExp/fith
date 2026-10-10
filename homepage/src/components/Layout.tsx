import { repositoryUrl } from "../content";

export function Header() {
  return (
    <header className="masthead">
      <a className="brand" href="#main" aria-label="fith 首页">
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path
            d="M5 5h22v22H5zM5 12h22M12 12v15M17 17h5M17 22h5"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
        <strong>fith</strong>
      </a>
      <nav className="nav" aria-label="主导航">
        <a href="#features">转换能力</a>
        <a href="#cases">真实案例</a>
        <a href="#usage">开始使用</a>
        <a href="#docs">项目文档</a>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <a className="brand" href="#main">
          fith
        </a>
        <p>HTML 与 CSS，自包含 SVG。</p>
        <a href={repositoryUrl}>GitHub</a>
        <a href="#main">返回顶部</a>
      </div>
    </footer>
  );
}
