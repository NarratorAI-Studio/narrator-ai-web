import { NextResponse } from 'next/server';

/**
 * Server-side feature flags API route.
 *
 * Reads env vars at REQUEST TIME (not build time), enabling runtime
 * control of kill switch and rollout percentage without rebuild.
 *
 * Server-side env vars (no NEXT_PUBLIC_ prefix):
 *   HARD_PRICE_ROLLOUT_PERCENT  — 0-100 rollout percentage
 *   HARD_PRICE_KILL_SWITCH      — "true" to force-disable hard price
 *
 * Falls back to NEXT_PUBLIC_ prefixed vars for backwards compatibility
 * during migration.
 */
export async function GET() {
  const killSwitch =
    process.env.HARD_PRICE_KILL_SWITCH ??
    process.env.NEXT_PUBLIC_HARD_PRICE_KILL_SWITCH ??
    'false';

  const rolloutRaw =
    process.env.HARD_PRICE_ROLLOUT_PERCENT ??
    process.env.NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT ??
    '0';

  const rolloutPercent = Math.max(0, Math.min(100, parseInt(rolloutRaw, 10) || 0));

  // v2 flags  — independent rollout so v2 confirm-page issues
  // can be killed without disabling v1 hard-price for already-bucketed
  // users. Default to disabled until the v2 confirm-page PR ships.
  const v2KillSwitch =
    process.env.HARD_PRICE_V2_KILL_SWITCH ??
    process.env.NEXT_PUBLIC_HARD_PRICE_V2_KILL_SWITCH ??
    'false';

  const v2RolloutRaw =
    process.env.HARD_PRICE_V2_ROLLOUT_PERCENT ??
    process.env.NEXT_PUBLIC_HARD_PRICE_V2_ROLLOUT_PERCENT ??
    '0';

  const v2RolloutPercent = Math.max(
    0,
    Math.min(100, parseInt(v2RolloutRaw, 10) || 0)
  );

  return NextResponse.json({
    hard_price_kill_switch: killSwitch === 'true',
    hard_price_rollout_percent: rolloutPercent,
    hard_price_v2_kill_switch: v2KillSwitch === 'true',
    hard_price_v2_rollout_percent: v2RolloutPercent,
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
