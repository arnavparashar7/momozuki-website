'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface DashboardMetrics {
  campaign: {
    id: string;
    slug: string;
    name: string;
    eligibilityMode: 'ANY' | 'ALL';
    active: boolean;
    maxSpots: number;
    collections: Array<{
      id: string;
      name: string;
      chain: string;
      contractAddress: string;
      minimumHeld: number;
    }>;
  };
  totalSpots: number;
  claimedSpots: number;
  remainingSpots: number;
  percentageClaimed: number;
}

interface ClaimRow {
  id: string;
  holderWallet: string;
  destinationWallet: string;
  chain: string;
  qualifyingCollections: Array<{ name?: string }> | null;
  status: string;
  createdAt: string;
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function parseJsonSafe(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function AdminPage() {
  const [checkedSession, setCheckedSession] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [claimsTotal, setClaimsTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [chainFilter, setChainFilter] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>();

  const loadDashboard = useCallback(async () => {
    const res = await fetch('/api/admin/dashboard');
    if (res.status === 401) {
      setAuthenticated(false);
      return;
    }
    const body = await parseJsonSafe(res);
    if (!res.ok) {
      setLoadError(body?.error?.message ?? 'Could not load dashboard.');
      return;
    }
    setMetrics(body);
  }, []);

  const loadClaims = useCallback(async (opts: { search?: string; chain?: string }) => {
    const params = new URLSearchParams();
    if (opts.search) params.set('search', opts.search);
    if (opts.chain) params.set('chain', opts.chain);
    const res = await fetch(`/api/admin/claims?${params.toString()}`);
    if (res.status === 401) {
      setAuthenticated(false);
      return;
    }
    const body = await parseJsonSafe(res);
    if (!res.ok) {
      setLoadError(body?.error?.message ?? 'Could not load claims.');
      return;
    }
    setClaims(body.claims);
    setClaimsTotal(body.total);
  }, []);

  useEffect(() => {
    fetch('/api/admin/session')
      .then((res) => res.json())
      .then((body: { authenticated: boolean }) => {
        setAuthenticated(body.authenticated);
        setCheckedSession(true);
        if (body.authenticated) {
          void loadDashboard();
          void loadClaims({});
        }
      })
      .catch(() => setCheckedSession(true));
  }, [loadDashboard, loadClaims]);

  function handleSearchChange(value: string) {
    setSearch(value);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      void loadClaims({ search: value, chain: chainFilter });
    }, 300);
  }

  function handleChainChange(value: string) {
    setChainFilter(value);
    void loadClaims({ search, chain: value });
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await parseJsonSafe(res);
      if (!res.ok) {
        setLoginError(body?.error?.message ?? 'Could not sign in.');
        return;
      }
      setAuthenticated(true);
      setPassword('');
      void loadDashboard();
      void loadClaims({});
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setAuthenticated(false);
    setMetrics(null);
    setClaims([]);
  }

  if (!checkedSession) {
    return null;
  }

  if (!authenticated) {
    return (
      <div className="admin">
        <nav className="fixed-nav">
          <div className="brand">
            <span className="brand-word">MOMOZUKI</span>
            <div className="hanko">
              <span>百月</span>
            </div>
          </div>
        </nav>
        <div className="admin-login-wrap">
          <form className="panel" style={{ maxWidth: 380 }} onSubmit={handleLogin}>
            <div className="panel-header">
              <span className="tagline">Admin Console</span>
              <h2>Sign in</h2>
            </div>
            <div className="field">
              <label htmlFor="admin-email">Email</label>
              <input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="admin-password">Password</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {loginError && <div className="helper error">{loginError}</div>}
            </div>
            <div className="panel-actions">
              <button className="btn btn-coral btn-block" type="submit" disabled={loggingIn}>
                {loggingIn ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="admin">
      <nav className="fixed-nav">
        <div className="brand">
          <span className="brand-word">MOMOZUKI</span>
          <div className="hanko">
            <span>百月</span>
          </div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={handleLogout}>
          Sign out
        </button>
      </nav>
      <div className="admin-body" style={{ paddingTop: 100 }}>
        <div className="admin-title-row">
          <div>
            <h1>Admin Console</h1>
            <p>{metrics?.campaign.name ?? 'Loading campaign…'}</p>
          </div>
        </div>

        {loadError && <div className="note-box">{loadError}</div>}

        {metrics && (
          <>
            <div className="metric-grid">
              <div className="metric-card">
                <span className="label on-cream">Total Spots</span>
                <div className="value">{metrics.totalSpots}</div>
              </div>
              <div className="metric-card">
                <span className="label on-cream">Claimed</span>
                <div className="value">{metrics.claimedSpots}</div>
              </div>
              <div className="metric-card">
                <span className="label on-cream">Remaining</span>
                <div className="value">{metrics.remainingSpots}</div>
              </div>
              <div className="metric-card">
                <span className="label on-cream">Percentage Claimed</span>
                <div className="value">
                  {metrics.percentageClaimed}
                  <small> %</small>
                </div>
              </div>
            </div>

            <div className="toolbar">
              <input
                className="search-input"
                placeholder="Search by holder or destination wallet…"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
              <div className="filter-bar">
                <select
                  className="chip-select"
                  value={chainFilter}
                  onChange={(e) => handleChainChange(e.target.value)}
                >
                  <option value="">All chains</option>
                  {Array.from(new Set(metrics.campaign.collections.map((c) => c.chain))).map((chain) => (
                    <option key={chain} value={chain}>
                      {chain}
                    </option>
                  ))}
                </select>
              </div>
              <div className="export-group">
                <a className="btn btn-outline on-cream btn-sm" href={`/api/admin/claims/export/csv?campaign=${metrics.campaign.slug}`}>
                  Export CSV
                </a>
                <a className="btn btn-outline on-cream btn-sm" href={`/api/admin/claims/export/json?campaign=${metrics.campaign.slug}`}>
                  Export JSON
                </a>
              </div>
            </div>

            <div className="table-wrap">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Holder Wallet</th>
                      <th>Destination Wallet</th>
                      <th>Claimed At</th>
                      <th>Qualifying Collection</th>
                      <th>Chain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.length === 0 && (
                      <tr>
                        <td colSpan={5}>No claims yet.</td>
                      </tr>
                    )}
                    {claims.map((c) => (
                      <tr key={c.id}>
                        <td>{short(c.holderWallet)}</td>
                        <td>{short(c.destinationWallet)}</td>
                        <td>{new Date(c.createdAt).toLocaleString()}</td>
                        <td>{c.qualifyingCollections?.[0]?.name ?? '-'}</td>
                        <td>
                          <span className="chain-pill">{c.chain}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="label on-cream" style={{ marginTop: -24, marginBottom: 'var(--s-7)' }}>
              Showing {claims.length} of {claimsTotal} claims
            </p>

            <div className="config-grid">
              <div className="config-card">
                <h3>Campaign Configuration</h3>
                <div className="config-row">
                  <span className="k">Eligibility Mode</span>
                  <span className="v">{metrics.campaign.eligibilityMode}</span>
                </div>
                <div className="config-row">
                  <span className="k">Max Spots</span>
                  <span className="v">{metrics.campaign.maxSpots}</span>
                </div>
                <div className="config-row">
                  <span className="k">Active</span>
                  <span className="v">{metrics.campaign.active ? 'Yes' : 'No'}</span>
                </div>
              </div>
              <div className="config-card">
                <h3>Eligibility Collections</h3>
                {metrics.campaign.collections.map((c) => (
                  <div className="config-row" key={c.id}>
                    <span className="k">{c.name}</span>
                    <span className="v">
                      {c.chain} · min {c.minimumHeld}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
