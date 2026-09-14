import { createThirdwebClient } from 'thirdweb';
import { THIRDWEB_CLIENT_ID } from '@/lib/public-env';

export const isThirdwebConfigured = THIRDWEB_CLIENT_ID.length > 0;

// thirdweb requires a non-empty clientId to construct; fall back to a
// placeholder so the app doesn't crash before a real one is configured -
// components should check isThirdwebConfigured and show a setup notice
// instead of rendering the connect button in that case.
export const thirdwebClient = createThirdwebClient({
  clientId: isThirdwebConfigured ? THIRDWEB_CLIENT_ID : '0'.repeat(32),
});
