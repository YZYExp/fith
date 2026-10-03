export function Header() {
  return (
    <header className="masthead">
      <a className="brand" href="#" aria-label="Recursion home">
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path
            d="M25 7H14a10 10 0 1 0 10 10V10M18 10h6v6"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
        <strong>recursion</strong>
      </a>
      <nav className="nav" aria-label="Main navigation">
        <a href="#ideas">The ideas</a>
        <a href="#loop">The feedback loop</a>
        <a href="#reading">Further reading</a>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <a className="brand" href="#">
          recursion
        </a>
        <p>An independent field guide. Not affiliated with Anthropic.</p>
        <a href="#main">Back to top</a>
      </div>
    </footer>
  );
}
