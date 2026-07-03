/**
 * Pricing v2 alias contract — pure shapers extracted from the confirm
 * page (`src/app/page.tsx`) so the cross-system identifier rules can be
 * unit-tested without mounting the component.
 *
 * The narrator primary ID (`CSV.id`, e.g. 303) and the canonical upstream
 * xy-`code` (e.g. "xy0178") are not interchangeable id spaces. These
 * helpers are the single place the web side decides which id rides on
 * which wire field.
 */

import type { BudgetSnapshot } from './master-task-types';
import type { PricingQuoteData, PricingQuoteRequest } from './pricing-quote-types';

/**
 * Minimal template identity the alias rules read. Mirrors the
 * identity-carrying fields of page.tsx's `TemplateItem`.
 */
export interface TemplateIdentity {
  /** Narrator 主 ID (`CSV.id`, e.g. 303). NOT the catalog tier id. */
  id: number;
  /** Canonical upstream xy-code (e.g. "xy0178"). */
  code?: string;
}

/**
 * Quote-request identity for a template-library, non custom-SRT v2 quote.
 * `code` is the canonical cross-system identifier the backend
 * derives the catalog tier from; `template_id` carries the narrator 主
 * ID as a legacy advisory value only. The two must not be collapsed into
 * one field; otherwise the backend reads `template_id` in the wrong
 * number space and returns CATALOG_TIER_MISSING.
 */
export function buildTemplateQuoteIdentity(
  template: TemplateIdentity,
): Pick<PricingQuoteRequest, 'code' | 'template_id'> {
  return {
    code: template.code,
    template_id: String(template.id),
  };
}

/**
 * Master-task identity. `template_id` keeps the narrator 主 ID
 * (NOT `v2Quote.template_id`, which for a code-driven quote is the
 * backend-derived catalog id, e.g. "178"); `code` is the canonical
 * identifier, preferring the value echoed by the quote. Both are omitted
 * for custom-SRT orders, which have no template catalog entry.
 */
export function buildMasterTaskIdentity(args: {
  confirmedTemplate?: TemplateIdentity | null;
  v2Quote?: Pick<PricingQuoteData, 'code'> | null;
  isCustomSrtTemplate: boolean;
}): { template_id: number | undefined; code: string | undefined } {
  const { confirmedTemplate, v2Quote, isCustomSrtTemplate } = args;
  if (isCustomSrtTemplate) {
    return { template_id: undefined, code: undefined };
  }
  return {
    template_id: confirmedTemplate?.id,
    code: v2Quote?.code ?? confirmedTemplate?.code,
  };
}

/**
 * Master-task budget snapshot for a v2 hard-price order.
 *
 * It must be a non-empty single-price hard-price snapshot, not the
 * deprecated consume-budget line-item breakdown.
 */
export function buildV2MasterBudgetSnapshot(
  v2Quote: Pick<
    PricingQuoteData,
    'final_charge_price' | 'combo_key' | 'pricing_rule_version'
  >,
): BudgetSnapshot {
  return {
    total_points: v2Quote.final_charge_price,
    hard_price: v2Quote.final_charge_price,
    combo_key: v2Quote.combo_key,
    pricing_rule_version: v2Quote.pricing_rule_version as unknown as number,
  };
}
