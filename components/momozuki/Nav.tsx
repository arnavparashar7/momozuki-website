export function Nav() {
  return (
    <nav className="fixed-nav">
      <div className="brand">
        <span className="brand-word">MOMOZUKI</span>
        <div className="hanko">
          <span>百月</span>
        </div>
      </div>
      <div className="nav-links">
        <a href="#details">Details</a>
        <a href="#claim">Enter</a>
      </div>
    </nav>
  );
}
