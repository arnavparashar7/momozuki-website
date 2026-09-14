'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectButton, useActiveAccount } from 'thirdweb/react';
import { isAddress } from 'viem';
import { thirdwebClient, isThirdwebConfigured } from '@/lib/thirdweb-client';

type MatchedCollection = {
  collectionId: string;
  name: string;
  chain: string;
  contractAddress: string;
  heldQuantity: number;
  minimumHeld: number;
};

type AuthorizePayload = {
  campaignId: string;
  destinationWallet: string;
  nonce: string;
  deadline: number;
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, string>;
  matchedCollections: MatchedCollection[];
};

type Stage =
  | { name: 'idle' }
  | { name: 'verifying' }
  | { name: 'eligible'; matchedCollections: MatchedCollection[] }
  | { name: 'ineligible' }
  | { name: 'destination'; matchedCollections: MatchedCollection[] }
  | { name: 'authorizing' }
  | { name: 'summary'; authorize: AuthorizePayload }
  | { name: 'claiming' }
  | { name: 'success'; destinationWallet: string; claimId: string }
  | { name: 'already-claimed'; destinationWallet: string }
  | { name: 'sold-out' }
  | { name: 'error'; message: string };

interface CampaignStatus {
  name: string;
  maxSpots: number;
  spotsRemaining: number;
  active: boolean;
}

const CAMPAIGN_SLUG = 'momozuki-genesis';

function short(addr: string | null | undefined): string {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function parseJsonSafe(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function ClaimFlow() {
  const account = useActiveAccount();
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [status, setStatus] = useState<CampaignStatus | null>(null);
  const [destinationInput, setDestinationInput] = useState('');
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const processedAccountRef = useRef<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaign/${CAMPAIGN_SLUG}/status`);
      if (res.ok) setStatus(await res.json());
    } catch {
      // Non-critical: the landing display just won't show live numbers.
    }
  }, []);

  // Public campaign status, independent of wallet connection.
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const checkEligibilityNow = useCallback(async () => {
    setStage({ name: 'verifying' });
    const res = await fetch(`/api/eligibility?campaign=${CAMPAIGN_SLUG}`);
    const body = await parseJsonSafe(res);
    if (!res.ok) {
      setStage({ name: 'error', message: body?.error?.message ?? 'Something went wrong.' });
      return;
    }
    if (body.eligible) {
      setDestinationInput(account?.address ?? '');
      setStage({ name: 'eligible', matchedCollections: body.matchedCollections });
    } else {
      setStage({ name: 'ineligible' });
    }
  }, [account]);

  // Reconnect support: on load, see if a session cookie is already valid
  // before asking the user to connect + sign again.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((body: { authenticated: boolean; wallet: string | null }) => {
        if (cancelled || !body.authenticated) return;
        processedAccountRef.current = body.wallet;
        void checkEligibilityNow();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drives the connect -> nonce -> sign -> verify -> eligibility sequence
  // whenever a new wallet becomes active.
  useEffect(() => {
    if (!account || processedAccountRef.current === account.address) return;
    processedAccountRef.current = account.address;
    let cancelled = false;

    async function run() {
      try {
        setStage({ name: 'verifying' });
        const nonceRes = await fetch('/api/auth/nonce', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: account!.address }),
        });
        const nonceBody = await parseJsonSafe(nonceRes);
        if (!nonceRes.ok) throw new Error(nonceBody?.error?.message ?? 'Could not start sign-in.');

        const signature = await account!.signMessage({ message: nonceBody.message });
        if (cancelled) return;

        const verifyRes = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: account!.address, nonce: nonceBody.nonce, signature }),
        });
        const verifyBody = await parseJsonSafe(verifyRes);
        if (!verifyRes.ok) throw new Error(verifyBody?.error?.message ?? 'Could not verify wallet.');
        if (cancelled) return;

        await checkEligibilityNow();
      } catch (err) {
        if (!cancelled) {
          setStage({
            name: 'error',
            message: err instanceof Error ? err.message : 'Something went wrong.',
          });
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [account, checkEligibilityNow]);

  async function handleDestinationContinue() {
    const val = destinationInput.trim();
    if (!isAddress(val)) {
      setDestinationError('Enter a valid wallet address to continue.');
      return;
    }
    setDestinationError(null);
    setStage({ name: 'authorizing' });

    const res = await fetch('/api/claim/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationWallet: val, campaign: CAMPAIGN_SLUG }),
    });
    const body = await parseJsonSafe(res);

    if (!res.ok) {
      switch (body?.error?.code) {
        case 'ALREADY_CLAIMED':
          setStage({ name: 'already-claimed', destinationWallet: val });
          return;
        case 'INELIGIBLE':
          setStage({ name: 'ineligible' });
          return;
        case 'SOLD_OUT':
          setStage({ name: 'sold-out' });
          return;
        default:
          setStage({ name: 'error', message: body?.error?.message ?? 'Something went wrong.' });
          return;
      }
    }

    setStage({ name: 'summary', authorize: body });
  }

  async function handleClaim(authorize: AuthorizePayload) {
    if (!account) return;
    setStage({ name: 'claiming' });
    try {
      const signature = await account.signTypedData({
        domain: authorize.domain,
        types: authorize.types as any,
        primaryType: authorize.primaryType,
        message: {
          ...authorize.message,
          deadline: BigInt(authorize.message.deadline ?? authorize.deadline),
        },
      } as any);

      const res = await fetch('/api/claim/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinationWallet: authorize.destinationWallet,
          nonce: authorize.nonce,
          deadline: authorize.deadline,
          signature,
          campaign: CAMPAIGN_SLUG,
        }),
      });
      const body = await parseJsonSafe(res);

      if (!res.ok) {
        switch (body?.error?.code) {
          case 'ALREADY_CLAIMED':
            setStage({ name: 'already-claimed', destinationWallet: authorize.destinationWallet });
            return;
          case 'SOLD_OUT':
            setStage({ name: 'sold-out' });
            return;
          case 'INELIGIBLE':
            setStage({ name: 'ineligible' });
            return;
          default:
            setStage({ name: 'error', message: body?.error?.message ?? 'Something went wrong.' });
            return;
        }
      }

      void refreshStatus();
      setStage({ name: 'success', destinationWallet: body.destinationWallet, claimId: body.claimId });
    } catch (err) {
      setStage({
        name: 'error',
        message: err instanceof Error ? err.message : 'Signature was not completed.',
      });
    }
  }

  function resetToIdle() {
    processedAccountRef.current = null;
    setStage({ name: 'idle' });
    void refreshStatus();
  }

  if (!isThirdwebConfigured) {
    return (
      <div className="stage">
        <div className="screen">
          <div className="panel" style={{ textAlign: 'center' }}>
            <p>
              Wallet connect isn&apos;t configured yet - set{' '}
              <code>NEXT_PUBLIC_THIRDWEB_CLIENT_ID</code> in your environment.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stage" id="stage">
      <div className="screen">
        {stage.name === 'idle' && (
          <div className="panel" style={{ textAlign: 'center' }}>
            <div className="panel-header" style={{ textAlign: 'center' }}>
              <span className="tagline">Ready when you are</span>
              <h2 className="hand" style={{ marginTop: 'var(--s-3)', fontSize: 22, color: 'var(--navy)' }}>
                Connect your wallet to check eligibility.
              </h2>
              <p>
                We&apos;ll verify your Momozuki holdings and walk you through claiming your
                spot, no gas required.
              </p>
            </div>
            <div className="row">
              <div>
                <span className="label on-cream">Collection</span>
                <div className="value big">{status?.name ?? 'Momozuki Genesis'}</div>
              </div>
            </div>
            <div className="row">
              <div>
                <span className="label on-cream">Spots Remaining</span>
                <div className="value">
                  {status ? `${status.spotsRemaining} of ${status.maxSpots}` : '…'}
                </div>
              </div>
            </div>
            <div className="panel-actions">
              <ConnectButton client={thirdwebClient} />
            </div>
          </div>
        )}

        {stage.name === 'verifying' && (
          <div className="panel" style={{ textAlign: 'center' }}>
            <div className="verify-visual">
              <div className="ring" />
            </div>
            <div className="verify-status">
              <h2>Verifying access</h2>
              <p>Checking your companion holdings…</p>
            </div>
          </div>
        )}

        {stage.name === 'eligible' && (
          <div className="panel">
            <div className="panel-header" style={{ textAlign: 'center' }}>
              <span className="badge ok" style={{ margin: '0 auto var(--s-4)' }}>
                <span className="dot" />
                Access verified
              </span>
              <h2>You hold a Momozuki companion.</h2>
            </div>
            <div className="row">
              <div>
                <span className="label on-cream">Qualifying Collection</span>
                <div className="value big">{stage.matchedCollections[0]?.name ?? 'Momozuki Genesis'}</div>
              </div>
            </div>
            <div className="row">
              <div>
                <span className="label on-cream">Connected Wallet</span>
                <div className="value">{short(account?.address)}</div>
              </div>
            </div>
            <div className="row">
              <div>
                <span className="label on-cream">Companion Balance</span>
                <div className="value">{stage.matchedCollections[0]?.heldQuantity ?? '-'}</div>
              </div>
            </div>
            <div className="row">
              <div>
                <span className="label on-cream">Spots Remaining</span>
                <div className="value">{status?.spotsRemaining ?? '-'}</div>
              </div>
            </div>
            <div className="panel-actions">
              <button
                className="btn btn-coral btn-block"
                onClick={() => setStage({ name: 'destination', matchedCollections: stage.matchedCollections })}
              >
                Continue to destination wallet
              </button>
            </div>
          </div>
        )}

        {stage.name === 'ineligible' && (
          <div className="panel" style={{ textAlign: 'center' }}>
            <span className="badge no" style={{ margin: '0 auto var(--s-5)' }}>
              <span className="dot" />
              Access unavailable
            </span>
            <h2 className="hand" style={{ fontSize: 22, marginBottom: 'var(--s-3)', color: 'var(--navy)' }}>
              This wallet doesn&apos;t hold a Momozuki companion.
            </h2>
            <p style={{ color: '#6B6250', fontSize: 14, marginBottom: 'var(--s-6)' }}>
              Early access requires holding at least one companion from the genesis
              collection. If you believe this is incorrect, try a different wallet.
            </p>
            <div className="panel-actions">
              <button className="btn btn-outline on-cream btn-block" onClick={resetToIdle}>
                Connect another wallet
              </button>
            </div>
          </div>
        )}

        {(stage.name === 'destination' || stage.name === 'authorizing') && (
          <div className="panel">
            <div className="panel-header">
              <span className="tagline">Step 2 of 2</span>
              <h2>Destination wallet</h2>
            </div>
            <div className="note-box">
              Your connected wallet is used only to verify companion ownership. You may
              designate a <strong>different wallet</strong> to receive your early
              access, useful if your Momozuki sits in cold storage.
            </div>
            <div className="field">
              <label htmlFor="destInput">Destination wallet</label>
              <input
                id="destInput"
                type="text"
                placeholder="0x..."
                value={destinationInput}
                onChange={(e) => setDestinationInput(e.target.value)}
                className={destinationError ? 'error' : ''}
              />
              <div className={`helper${destinationError ? ' error' : ''}`}>
                {destinationError ??
                  'This is the wallet that will be recorded for the whitelist. Defaults to your connected wallet.'}
              </div>
            </div>
            <div className="panel-actions">
              <button
                className="btn btn-coral btn-block"
                onClick={handleDestinationContinue}
                disabled={stage.name === 'authorizing'}
              >
                {stage.name === 'authorizing' ? 'Checking…' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {(stage.name === 'summary' || stage.name === 'claiming') && (
          <div className="panel">
            <div className="panel-header">
              <span className="tagline">Review</span>
              <h2>Confirm your claim</h2>
            </div>
            <div className="row">
              <div>
                <span className="label on-cream">Verified Wallet</span>
                <div className="value">{short(account?.address)}</div>
              </div>
            </div>
            <div className="row">
              <div>
                <span className="label on-cream">Destination Wallet</span>
                <div className="value">
                  {short(stage.name === 'summary' ? stage.authorize.destinationWallet : undefined)}
                </div>
              </div>
            </div>
            <div className="row">
              <div>
                <span className="label on-cream">Allocation</span>
                <div className="value">1 spot</div>
              </div>
            </div>
            <div className="panel-actions">
              <button
                className="btn btn-coral btn-block"
                disabled={stage.name === 'claiming'}
                onClick={() => stage.name === 'summary' && handleClaim(stage.authorize)}
              >
                {stage.name === 'claiming' ? 'Awaiting signature…' : 'Claim Spot'}
              </button>
              <div className="gas-note">Signature only · No gas required</div>
            </div>
          </div>
        )}

        {stage.name === 'success' && (
          <div className="panel" style={{ textAlign: 'center' }}>
            <div className="success-visual">
              <div className="success-ring">
                <span className="success-mark">✓</span>
              </div>
            </div>
            <h2 className="hand" style={{ fontSize: 25, marginBottom: 'var(--s-2)', color: 'var(--navy)' }}>
              Access confirmed.
            </h2>
            <p style={{ color: '#6B6250', fontSize: 14, marginBottom: 'var(--s-6)' }}>
              Your place has been secured.
            </p>
            <div className="row">
              <div>
                <span className="label on-cream">Destination Wallet</span>
                <div className="value">{short(stage.destinationWallet)}</div>
              </div>
            </div>
            <div className="row">
              <div>
                <span className="label on-cream">Claim Reference</span>
                <div className="value">{stage.claimId.slice(0, 8)}</div>
              </div>
            </div>
            <div className="row">
              <div>
                <span className="label on-cream">Remaining</span>
                <div className="value">{status?.spotsRemaining ?? '-'}</div>
              </div>
            </div>
            <div className="panel-actions">
              <button className="btn btn-outline on-cream btn-block" onClick={resetToIdle}>
                Return to overview
              </button>
            </div>
          </div>
        )}

        {stage.name === 'already-claimed' && (
          <div className="panel" style={{ textAlign: 'center' }}>
            <span className="badge neutral" style={{ margin: '0 auto var(--s-5)' }}>
              <span className="dot" />
              Already claimed
            </span>
            <h2 className="hand" style={{ fontSize: 22, marginBottom: 'var(--s-3)', color: 'var(--navy)' }}>
              This wallet already secured its allocation.
            </h2>
            <div className="row">
              <div>
                <span className="label on-cream">Destination Wallet</span>
                <div className="value">{short(stage.destinationWallet)}</div>
              </div>
            </div>
            <div className="panel-actions">
              <button className="btn btn-outline on-cream btn-block" onClick={resetToIdle}>
                Connect a different wallet
              </button>
            </div>
          </div>
        )}

        {stage.name === 'sold-out' && (
          <div className="panel" style={{ textAlign: 'center' }}>
            <div className="sold-visual">
              <div className="moon-num-sm">0</div>
              <div className="label on-cream" style={{ marginTop: 8 }}>
                Spots Remaining
              </div>
            </div>
            <h2 className="hand" style={{ fontSize: 22, margin: 'var(--s-4) 0 var(--s-3)', color: 'var(--navy)' }}>
              Early access fully claimed.
            </h2>
            <p style={{ color: '#6B6250', fontSize: 14 }}>
              The allocation has been fully claimed. Follow Momozuki for news on the
              next window.
            </p>
          </div>
        )}

        {stage.name === 'error' && (
          <div className="panel" style={{ textAlign: 'center' }}>
            <span className="badge no" style={{ margin: '0 auto var(--s-5)' }}>
              <span className="dot" />
              Something went wrong
            </span>
            <p style={{ color: '#6B6250', fontSize: 14, marginBottom: 'var(--s-6)' }}>{stage.message}</p>
            <div className="panel-actions">
              <button className="btn btn-outline on-cream btn-block" onClick={resetToIdle}>
                Start over
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
