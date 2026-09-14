/**
 * The exact message a wallet signs to prove control of an address. Kept
 * deterministic and reconstructed server-side from (wallet, nonce) rather
 * than trusted from the client, so verification can't be tricked by a
 * client-supplied message string.
 *
 * Deliberately NOT a static message (per the AUTHENTICATION requirement) -
 * the nonce makes every signing request unique, which is what prevents a
 * captured signature from being replayed later.
 */
export function buildAuthMessage(wallet: string, nonce: string): string {
  return [
    'Momozuki wants you to sign in with your wallet.',
    '',
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    '',
    'This request will not trigger a blockchain transaction and will not cost any gas.',
  ].join('\n');
}
