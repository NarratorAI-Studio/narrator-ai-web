/**
 * Mock mode guard for wallet BFF routes.
 * Only enabled when ALL of:
 *   1. NODE_ENV is not 'production'
 *   2. WALLET_MOCK_ENABLED === 'true'
 *
 * If WALLET_BACKEND_URL is absent in production, routes return 503 instead of
 * silently fabricating a successful charge — preventing billing bypass.
 */
export const IS_WALLET_MOCK =
  process.env.NODE_ENV !== 'production' &&
  process.env.WALLET_MOCK_ENABLED === 'true';

export function walletBackendUnconfigured() {
  return !process.env.WALLET_BACKEND_URL && !IS_WALLET_MOCK;
}
