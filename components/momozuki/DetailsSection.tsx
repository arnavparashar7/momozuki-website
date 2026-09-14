export function DetailsSection() {
  return (
    <div className="details-section" id="details">
      <div className="details">
        <div className="detail-card">
          <svg
            className="icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
          >
            <path d="M4 9c2-2.5 4-4 8-4s6 1.5 8 4M2 9h20M6 9v11M18 9v11M4 20h16" />
          </svg>
          <span className="label on-cream">The Collection</span>
          <p>
            Momozuki is a collection of 555 hand-drawn companions from a forgotten
            world: wandering souls, lost things, and quiet dreamers.
          </p>
        </div>
        <div className="detail-card">
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <path d="M12 3a9 9 0 1 0 8.94 10.06A7 7 0 0 1 12 3z" />
          </svg>
          <div className="figure">555</div>
          <p>
            Spots in this early access window. Each qualifying wallet may claim once,
            regardless of how many companions it holds.
          </p>
        </div>
        <div className="detail-card">
          <svg
            className="icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
          >
            <path d="M12 2l1.6 4.8L18 8l-4.4 1.2L12 14l-1.6-4.8L6 8l4.4-1.2L12 2z" />
            <circle cx={18} cy={17} r={2} />
          </svg>
          <span className="label on-cream">Requirement</span>
          <p>
            Hold at least one companion from the Momozuki genesis collection at time
            of verification. No transaction or gas is required to claim.
          </p>
        </div>
      </div>
    </div>
  );
}
