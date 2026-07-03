/**
 * Feature flag system for progressive hard-price rollout (HP-15).
 *
 * Flags are fetched from the server-side API route /api/narrator/feature-flags
 * which reads env vars at REQUEST TIME (not build time). This enables:
 *   - Kill switch takes effect on app restart (no rebuild needed)
 *   - Rollout percentage adjustable at runtime
 *
 * Rollout control:
 *   0   = hard price disabled (all users on old path)
 *   10  = 10% canary rollout
 *   50  = 50% rollout
 *   100 = GA (all users on hard price)
 *
 * Fast rollback: set HARD_PRICE_KILL_SWITCH=true and restart.
 *
 * Reference: hard-price rollout control.
 */

interface FeatureFlags {
  hard_price_kill_switch: boolean;
  hard_price_rollout_percent: number;
  /** v2 (confirm-page final price flow, regression coverage) — independent of v1. */
  hard_price_v2_kill_switch: boolean;
  hard_price_v2_rollout_percent: number;
}

/** Cached flags with TTL to avoid hitting the API on every call. */
let _cachedFlags: FeatureFlags | null = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

export function resetFeatureFlagsCacheForTests(): void {
  _cachedFlags = null;
  _cacheExpiry = 0;
}

/**
 * Fetch feature flags from the server-side API route.
 * Caches for 30 seconds to avoid excessive requests.
 * Falls back to NEXT_PUBLIC_ env vars if the API call fails.
 */
export async function fetchFeatureFlags(): Promise<FeatureFlags> {
  const now = Date.now();
  if (_cachedFlags && now < _cacheExpiry) return _cachedFlags;

  try {
    const res = await fetch('/api/narrator/feature-flags', { cache: 'no-store' });
    if (res.ok) {
      _cachedFlags = await res.json();
      _cacheExpiry = now + CACHE_TTL_MS;
      return _cachedFlags!;
    }
  } catch {
    // API unavailable — fall through to env var fallback
  }

  // Fallback: read NEXT_PUBLIC_ vars (build-time values)
  return {
    hard_price_kill_switch:
      process.env.NEXT_PUBLIC_HARD_PRICE_KILL_SWITCH === 'true',
    hard_price_rollout_percent: Math.max(
      0,
      Math.min(100, parseInt(process.env.NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT ?? '0', 10) || 0),
    ),
    hard_price_v2_kill_switch:
      process.env.NEXT_PUBLIC_HARD_PRICE_V2_KILL_SWITCH === 'true',
    hard_price_v2_rollout_percent: Math.max(
      0,
      Math.min(
        100,
        parseInt(process.env.NEXT_PUBLIC_HARD_PRICE_V2_ROLLOUT_PERCENT ?? '0', 10) || 0,
      ),
    ),
  };
}

/**
 * Get the current rollout percentage.
 * Synchronous fallback for backwards compatibility.
 */
export function getHardPriceRolloutPercent(): number {
  if (_cachedFlags) return _cachedFlags.hard_price_rollout_percent;
  const raw = process.env.NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT;
  if (!raw) return 0;
  const pct = parseInt(raw, 10);
  if (isNaN(pct) || pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

/**
 * Simple string hash function (djb2 variant).
 * Returns a number between 0 and 99 for bucketing.
 */
function hashToBucket(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash) % 100;
}

/**
 * Check if hard price is enabled for a specific user.
 */
export function isHardPriceEnabled(appKey: string): boolean {
  const rolloutPercent = getHardPriceRolloutPercent();
  if (rolloutPercent === 0) return false;
  if (rolloutPercent >= 100) return true;
  const bucket = hashToBucket(appKey);
  return bucket < rolloutPercent;
}

/**
 * Kill switch: force-disable hard price regardless of rollout percentage.
 * Reads from cached server-side flags first, falls back to env var.
 */
export function isKillSwitchActive(): boolean {
  if (_cachedFlags) return _cachedFlags.hard_price_kill_switch;
  return process.env.NEXT_PUBLIC_HARD_PRICE_KILL_SWITCH === 'true';
}

/**
 * Combined check: is hard price enabled for this user AND not killed?
 * This is the primary synchronous function to use in application code.
 *
 * IMPORTANT: call fetchFeatureFlags() once at page load to populate cache,
 * then use this function synchronously for individual checks.
 */
export function shouldUseHardPrice(appKey: string): boolean {
  if (isKillSwitchActive()) return false;
  return isHardPriceEnabled(appKey);
}

// ─── v2 (confirm-page final price flow, regression coverage) ─────────────────────────────
//
// Independent of v1 so the v2 confirm-page can be canary'd / killed
// without disturbing users already bucketed onto v1. v2 also kicks in
// when v1 is killed — the two surfaces don't share kill-switch state.

function getHardPriceV2RolloutPercent(): number {
  if (_cachedFlags) return _cachedFlags.hard_price_v2_rollout_percent;
  const raw = process.env.NEXT_PUBLIC_HARD_PRICE_V2_ROLLOUT_PERCENT;
  if (!raw) return 0;
  const pct = parseInt(raw, 10);
  if (isNaN(pct) || pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

function isHardPriceV2KillSwitchActive(): boolean {
  if (_cachedFlags) return _cachedFlags.hard_price_v2_kill_switch;
  return process.env.NEXT_PUBLIC_HARD_PRICE_V2_KILL_SWITCH === 'true';
}

/**
 * Combined v2 check. Bucketing intentionally uses a different salt so
 * a user in v1's 50% bucket isn't automatically in v2's 50% bucket —
 * v2 canary deserves its own sample.
 */
export function shouldUseHardPriceV2(appKey: string): boolean {
  if (isHardPriceV2KillSwitchActive()) return false;
  const pct = getHardPriceV2RolloutPercent();
  if (pct === 0) return false;
  if (pct >= 100) return true;
  return hashToBucket(`v2:${appKey}`) < pct;
}
