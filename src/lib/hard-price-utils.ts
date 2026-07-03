/**
 * Hard price display utilities for the order confirmation page (HP-XX).
 *
 * When a preset template-library template is selected, the order confirmation
 * page should show a single fixed hard price instead of a dynamic line-item
 * breakdown (legacy consume-budget, now deprecated).
 *
 * Template-library selections show the configured fixed price for the
 * selected combo, independent of episode count.
 */

import type { BudgetSnapshot } from './master-task-types';

/**
 * Hard price detail from the backend API.
 * Matches the response of POST /api/narrator/hard-price
 */
export interface HardPriceDetail {
  template_id: number;
  combo_key: string;
  hard_price: number;
  text_chars: number;
  text_lines: number;
  billing_duration_minutes: number;
  pricing_rule_version: number;
}

/**
 * All 5-tier prices for a template.
 * Matches GET /api/narrator/hard-price/all
 */
export interface HardPriceAllTiers {
  template_id: number;
  prices: HardPriceDetail[];
}

/**
 * Combo key display names for the UI.
 * Keys match the backend pricing API (POST /pricing/hard-price, POST /pricing/srt-realtime-quote).
 */
export const COMBO_KEY_LABELS: Record<string, string> = {
  original_narration_flash: '原创纯解说·极速版',
  original_narration_pro: '原创纯解说·旗舰版',
  original_remix_flash: '原声混剪·极速版',
  original_remix_pro: '原声混剪·旗舰版',
  secondary_creation: '二创文案',
};

/**
 * Subset of the v2 catalog tier object returned by backend
 * `/pricing/movie-baokuan` (post Backend API contract) under each
 * item's `tiers` map. Only the fields the web list-page consumes are
 * declared here — the backend payload carries more (`raw_rate`,
 * `final_rate`, `effective_version`, etc.) which are ignored.
 */
export interface V2CatalogTier {
  tier_code: string;
  manual_price: number;
  system_reference_price: number;
  pro_surcharge_display: number | null;
  flash_pro_axis: 'required' | 'optional';
  pricing_rule_version: string;
}

/**
 * v2 `tier_code` → v1 `combo_key` translation. v1 names live on in
 * `COMBO_KEY_LABELS`, `resolveComboKey`, and the `/pricing/hard-price`
 * request shape, so anything that derives a cache row from v2 must
 * translate two of the five names (`mix` ↔ `remix`, `derivative` ↔
 * `secondary_creation`). The two `narration_*` codes are identical
 * on both sides.
 */
export const TIER_CODE_TO_COMBO_KEY: Record<string, string> = {
  original_narration_flash: 'original_narration_flash',
  original_narration_pro: 'original_narration_pro',
  original_mix_flash: 'original_remix_flash',
  original_mix_pro: 'original_remix_pro',
  derivative: 'secondary_creation',
};

/**
 * v1/UI combo_key -> v2 catalog tier_code translation.
 *
 * The backend quote endpoint currently has two legitimate dialects:
 * - existing-template catalog quotes use v2 tier_codes
 *   (`original_mix_*`, `derivative`);
 * - custom-SRT quotes still use the legacy SRT pricing combo_keys
 *   (`original_remix_*`, `secondary_creation`).
 *
 * Keep the UI and legacy hard-price helpers on combo_key, but translate
 * explicitly before calling a `template_id` v2 quote. This prevents
 * 原声混剪 / 二创 existing-template orders from failing with
 * QUOTE_COMBO_KEY_INVALID.
 */
export const COMBO_KEY_TO_TIER_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(TIER_CODE_TO_COMBO_KEY).map(([tierCode, comboKey]) => [comboKey, tierCode])
);

export function toCatalogTierCode(comboKey: string): string {
  return COMBO_KEY_TO_TIER_CODE[comboKey] ?? comboKey;
}

/**
 * Map a v2 `tiers` map (as returned by `/pricing/movie-baokuan` per
 * item) into the v1-shaped `HardPriceDetail[]` the existing
 * `templatePricesCache` consumers (chip "起 X 点", detail-dialog
 * price ladder) read. Lets the list page skip the N+1
 * `fetchAllHardPrices` round-trips for items whose tiers landed in
 * the list response.
 *
 * Unknown tier_codes are dropped (defense against backend adding a
 * 6th tier later). Fields not available from the list response
 * (text_chars / text_lines / billing_duration_minutes /
 * pricing_rule_version-as-number) are filled with 0 — the chip +
 * detail dialog read only `hard_price` and `combo_key`, so the 0s
 * are inert; if a future consumer reads them, it must source the
 * authoritative values via `fetchHardPrice` or `fetchAllHardPrices`.
 */
export function tiersToHardPriceDetails(
  templateId: number,
  tiers: Record<string, V2CatalogTier>
): HardPriceDetail[] {
  const result: HardPriceDetail[] = [];
  for (const [tierCode, tier] of Object.entries(tiers)) {
    const comboKey = TIER_CODE_TO_COMBO_KEY[tierCode];
    if (!comboKey) continue;
    result.push({
      template_id: templateId,
      combo_key: comboKey,
      hard_price: tier.manual_price,
      text_chars: 0,
      text_lines: 0,
      billing_duration_minutes: 0,
      pricing_rule_version: 0,
    });
  }
  return result;
}

/**
 * Determine the combo_key from the user's current writing-type selection.
 *
 * writingType values (from WRITING_TYPES):
 *   1 = 原创文案（纯解说）→ original_narration_{model}
 *   2 = 原创文案（原声混剪）→ original_remix_{model}
 *   0 = 二创文案 → secondary_creation
 */
export function resolveComboKey(writingType: 0 | 1 | 2, textModel: 'flash' | 'pro'): string {
  if (writingType === 0) return 'secondary_creation';
  const prefix = writingType === 1 ? 'original_narration' : 'original_remix';
  return `${prefix}_${textModel}`;
}

/**
 * Return the combo_keys relevant to a given writing-type selection.
 *
 * Used to filter the template detail dialog's price-tier list and the
 * card price chip down to tiers the user can actually transact on,
 * given their Step 1 文案类型 choice.
 *
 *   0 (二创文案)    → [secondary_creation]
 *   1 (纯解说)      → [original_narration_flash, original_narration_pro]
 *   2 (原声混剪)    → [original_remix_flash, original_remix_pro]
 */
export function relevantComboKeysForWritingType(writingType: 0 | 1 | 2): string[] {
  if (writingType === 0) return ['secondary_creation'];
  const prefix = writingType === 1 ? 'original_narration' : 'original_remix';
  return [`${prefix}_flash`, `${prefix}_pro`];
}

// ─── SRT Realtime Quote ───────────────────────────────────────────────────────

export interface SrtRealtimeQuoteBreakdownItem {
  item: string;
  points: number;
  // Optional Chinese display label sourced from v2 quote's
  // `display_label`. Legacy v1 `/pricing/srt-realtime-quote` does not
  // populate this — consumers must fall back to a local labels map
  // keyed by `item` for the v1 path.
  label?: string;
}

export interface SrtRealtimeQuoteResponse {
  // Present only when sourced from hard-price v2 `/pricing/quote`.
  // Legacy `/pricing/srt-realtime-quote` is an estimate and has no locked quote.
  quote_id?: string;
  combo_key: string;
  estimated_points: number;
  pricing_rule_version: number;
  srt_metrics: {
    text_chars: number;
    text_lines: number;
    billing_minutes: number;
  };
  breakdown: SrtRealtimeQuoteBreakdownItem[];
  correlation_id?: string;
}

/**
 * Format the hard price for display.
 *
 * @param price The hard price number
 * @returns Formatted string like "84.50 点"
 */
export function formatHardPrice(price: number): string {
  return `${price.toFixed(2)} 点`;
}

/**
 * Create a budget_snapshot object for hard-price orders.
 * Replaces the legacy consume-budget-based snapshot for template library orders.
 *
 * Key: hard_price is NOT multiplied by episode count.
 * product requirement §三.6: "模板价格为单次模板库下单固定价格"
 */
export function createHardPriceBudgetSnapshot(detail: HardPriceDetail): BudgetSnapshot {
  return {
    total_points: detail.hard_price,
    hard_price: detail.hard_price,
    combo_key: detail.combo_key,
    billing_duration_minutes: detail.billing_duration_minutes,
    text_chars: detail.text_chars,
    text_lines: detail.text_lines,
    pricing_rule_version: detail.pricing_rule_version,
    // Legacy fields set to 0 for backward compat
    learning_points: 0,
    writing_points: 0,
    composing_points: 0,
  };
}

/**
 * Order modification metrics (M1.1 of regression coverage hard-price exposure process).
 *
 * Captures the relationship between the template's baseline duration and
 * the user's final modified script, so M2.1 dashboard  can surface
 * cost exposure and M2.2  can trigger template recycling / repricing.
 *
 * Field semantics per the internal design spec.
 */
export interface OrderModificationMetrics {
  /** Template baseline duration (minutes). Source: HardPriceDetail.billing_duration_minutes */
  original_template_minutes: number;
  /** User's final submitted script duration (minutes). Source: order submission */
  modified_script_minutes: number;
  /** Delta = modified - original. May be negative if the user shortened the script. */
  delta_minutes: number;
  /** Ratio = delta / original. 0 = unmodified; 0.5 = 150% of baseline; etc. */
  modification_ratio: number;
}

/**
 * Compute order modification metrics for an order.
 *
 * Precision: 4 decimal places (matches unit-test contract from regression coverage body).
 * Edge case: if the template baseline is 0 (degenerate template), ratio is 0.
 *
 * @param detail Hard price detail from the pricing API (provides baseline)
 * @param finalScriptMinutes User's final modified script duration
 * @returns Metrics object ready for telemetry ingestion
 */
export function computeModificationMetrics(
  detail: HardPriceDetail,
  finalScriptMinutes: number
): OrderModificationMetrics {
  const original = detail.billing_duration_minutes;
  const modified = finalScriptMinutes;
  const delta = modified - original;
  const ratio = original > 0 ? delta / original : 0;
  return {
    original_template_minutes: Number(original.toFixed(4)),
    modified_script_minutes: Number(modified.toFixed(4)),
    delta_minutes: Number(delta.toFixed(4)),
    modification_ratio: Number(ratio.toFixed(4)),
  };
}

/**
 * Fetch the hard price for a specific template + combo_key.
 *
 * @param templateId Template database ID
 * @param comboKey The resolved combo_key
 * @param headers Request headers (must include x-app-key)
 */
export async function fetchHardPrice(
  templateId: number,
  comboKey: string,
  headers: HeadersInit
): Promise<HardPriceDetail | null> {
  try {
    const res = await fetch('/api/narrator/hard-price', {
      method: 'POST',
      headers,
      body: JSON.stringify({ template_id: templateId, combo_key: comboKey }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      return json.data as HardPriceDetail;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch all 5-tier prices for a template (for template page display).
 */
export async function fetchAllHardPrices(
  templateId: number,
  headers: HeadersInit
): Promise<HardPriceAllTiers | null> {
  try {
    const res = await fetch(`/api/narrator/hard-price/all?template_id=${templateId}`, {
      method: 'GET',
      headers,
    });
    const json = await res.json();
    if (json.success && json.data) {
      return json.data as HardPriceAllTiers;
    }
    return null;
  } catch {
    return null;
  }
}
