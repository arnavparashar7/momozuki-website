import { MomozukiHero3D } from './MomozukiHero3D';

export function Hero() {
  return (
    <div className="hero">
      <MomozukiHero3D />
      <div className="hero-content">
        <div className="eyebrow-row">
          <span className="dot" />
          <span className="tagline">Early Access</span>
        </div>
        <h1 className="hand">
          Small souls,
          <br />a seat reserved.
        </h1>
        <p>
          555 hand-drawn companions from a forgotten world are waiting at the gate.
          Verify your wallet and claim your place before the moon sets.
        </p>
        <div className="stats">
          <div>
            <div className="stat-num hand">555</div>
            <div className="label stat-label">Companions</div>
          </div>
          <div>
            <div className="stat-num hand">555</div>
            <div className="label stat-label">Spots Available</div>
          </div>
        </div>
        <div className="actions">
          <a href="#claim" className="btn btn-coral">
            Enter the Claim →
          </a>
        </div>
      </div>
      <div className="vertical-jp">
        また、どこかで
        <span className="en">SEE YOU SOMEWHERE AGAIN</span>
      </div>
    </div>
  );
}
