/**
 * Pure derivation helpers for the admin pricing-catalog editor.
 *
 * Extracted from the page so the surcharge-derivation and
 * payload-shaping rules can be unit-tested without mounting the
 * component. The page composes them with the form state; the backend
 * contract is defined by the sibling backend service's catalog schema.
 */

export interface TierDraft {
  tier_code: string;
  product_line: string;
  mode: string | null;
  quality: string | null;
  flash_pro_axis: 'required' | 'optional';
  manual_price: string;
  pro_surcharge_display: string;
  system_reference_price: string;
  raw_rate: string;
  final_rate: string;
  rounding_rule_version: string;
  effective_version?: number;
  manual_override_warning?: boolean;
}

export type TierCompleteness = 'empty' | 'partial' | 'complete';

/** Find the Flash tier matching a Pro tier (same product_line + mode).
 * Used to derive `pro_surcharge_display` at submit time. Returns null
 * if no matching Flash carries a usable manual_price — caller treats
 * the Pro tier as `partial` and warns the operator. */
export function matchingFlashTier(
  pro: TierDraft,
  allTiers: TierDraft[],
): TierDraft | null {
  return (
    allTiers.find(
      (o) =>
        o.quality === 'flash' &&
        o.product_line === pro.product_line &&
        o.mode === pro.mode &&
        o.manual_price.trim() !== '',
    ) ?? null
  );
}

/** Convert a single draft tier to the backend PUT payload, or null
 * when the row can't form a valid submission yet (missing required
 * inputs, or Pro tier without matching Flash to derive surcharge
 * from). The backend fills omitted raw_rate / final_rate /
 * rounding_rule_version with sensible defaults (`Backend API contract`),
 * so we omit those fields entirely from the wire envelope. */
export function toServerTier(
  t: TierDraft,
  allTiers: TierDraft[],
): Record<string, unknown> | null {
  const manualPrice = parseInt(t.manual_price, 10);
  const systemReferencePrice = parseInt(t.system_reference_price, 10);
  if (Number.isNaN(manualPrice) || Number.isNaN(systemReferencePrice)) {
    return null;
  }
  const payload: Record<string, unknown> = {
    tier_code: t.tier_code,
    product_line: t.product_line,
    mode: t.mode,
    quality: t.quality,
    flash_pro_axis: t.flash_pro_axis,
    manual_price: manualPrice,
    system_reference_price: systemReferencePrice,
  };
  if (t.quality === 'pro') {
    const flash = matchingFlashTier(t, allTiers);
    if (!flash) return null;
    const flashPrice = parseInt(flash.manual_price, 10);
    if (Number.isNaN(flashPrice)) return null;
    const surcharge = manualPrice - flashPrice;
    if (surcharge < 0) return null;
    payload.pro_surcharge_display = surcharge;
  }
  return payload;
}

/** Classify a draft tier as empty, partial, or complete. Partial
 * tiers are non-empty rows that `toServerTier` can't yet shape —
 * typically a half-typed Pro tier waiting on its Flash sibling. The
 * page surfaces them in a banner so the operator doesn't lose them
 * to a silent drop on save. */
export function tierCompleteness(
  t: TierDraft,
  allTiers: TierDraft[],
): TierCompleteness {
  const anyFilled =
    t.manual_price.trim() !== '' || t.system_reference_price.trim() !== '';
  if (!anyFilled) return 'empty';
  return toServerTier(t, allTiers) ? 'complete' : 'partial';
}

/** Live invariant check on the form draft before submit. With regression coverage
 * the per-tier `pro_surcharge_display` input is gone — surcharge is
 * always derived from the price diff — so the only remaining
 * cross-tier check is Pro >= Flash. The "Pro = Flash + surcharge"
 * identity holds by construction. */
export function checkInvariants(
  tiers: TierDraft[],
  labels: Record<string, string>,
): string[] {
  const errs: string[] = [];
  const flashByPair = new Map<string, TierDraft>();
  const proByPair = new Map<string, TierDraft>();
  for (const t of tiers) {
    if (!t.manual_price) continue;
    const key = `${t.product_line}|${t.mode ?? ''}`;
    if (t.quality === 'flash') flashByPair.set(key, t);
    else if (t.quality === 'pro') proByPair.set(key, t);
  }
  for (const [, pro] of proByPair) {
    const key = `${pro.product_line}|${pro.mode ?? ''}`;
    const flash = flashByPair.get(key);
    if (!flash) continue;
    const proP = parseInt(pro.manual_price, 10);
    const flashP = parseInt(flash.manual_price, 10);
    if (proP < flashP) {
      errs.push(
        `${labels[pro.tier_code] ?? pro.tier_code}: Pro 价 (${proP}) 不能低于 Flash 价 (${flashP})`,
      );
    }
  }
  return errs;
}
