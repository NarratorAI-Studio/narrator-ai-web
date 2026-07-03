import { describe, it, expect } from 'vitest';
import {
  buildTemplateQuoteIdentity,
  buildMasterTaskIdentity,
  buildV2MasterBudgetSnapshot,
} from './pricing-alias-contract';
import seeds from './__fixtures__/pricing-alias-contract.json';

/**
 * Pricing v2 alias contract gate.
 *
 * Regression seeds cover the narrator primary ID vs canonical xy-code
 * distinction. The fixture is the single source of truth for these
 * identity-shaping tests.
 */

interface Cluster {
  case_id: string;
  title: string;
  template: { id: number; code?: string };
  v2_quote: {
    code: string;
    final_charge_price: number;
    combo_key: string;
    pricing_rule_version: string;
  };
  expected_quote_identity: { code: string; template_id: string };
  expected_catalog_tier: number;
  expected_master_task_identity: { template_id: number; code: string };
}

const clusters = seeds.clusters as Cluster[];

describe('alias contract — quote identity (narrator id vs canonical code)', () => {
  it.each(clusters)('$case_id: $title', (c) => {
    // code is the canonical identifier; template_id carries the
    // narrator 主 ID as a string, never collapsed into one field.
    expect(buildTemplateQuoteIdentity(c.template)).toEqual(c.expected_quote_identity);
  });

  it.each(clusters)(
    '$case_id: catalog tier derives from code, NOT the narrator 主 ID',
    (c) => {
      // Backend derives the catalog tier via int(code[2:]). The whole
      // point is that this is a different number space from the narrator
      // 主 ID — pin both: code→tier holds, and id≠tier.
      expect(Number(c.template.code!.slice(2))).toBe(c.expected_catalog_tier);
      expect(c.template.id).not.toBe(c.expected_catalog_tier);
    },
  );

  it('never fabricates a code when the template has none', () => {
    expect(buildTemplateQuoteIdentity({ id: 303 })).toEqual({
      code: undefined,
      template_id: '303',
    });
  });
});

describe('alias contract — master-task identity', () => {
  it.each(clusters)('$case_id: $title', (c) => {
    // template_id keeps the narrator 主 ID (NOT the quote-echoed catalog
    // id); code prefers the value echoed by the quote.
    expect(
      buildMasterTaskIdentity({
        confirmedTemplate: c.template,
        v2Quote: c.v2_quote,
        isCustomSrtTemplate: false,
      }),
    ).toEqual(c.expected_master_task_identity);
  });

  it('omits template_id and code for custom-SRT orders', () => {
    const { template, v2_quote } = seeds.custom_srt_case;
    const identity = buildMasterTaskIdentity({
      confirmedTemplate: template,
      v2Quote: v2_quote,
      isCustomSrtTemplate: true,
    });
    expect(identity.template_id).toBeUndefined();
    expect(identity.code).toBeUndefined();
  });
});

describe('alias contract — v2 hard-price budget snapshot', () => {
  it.each(clusters)(
    '$case_id: snapshot is a non-empty single-price hard-price snapshot',
    (c) => {
      const snap = buildV2MasterBudgetSnapshot(c.v2_quote);
      // Non-empty: all hard-price fields populated.
      expect(snap.total_points).toBe(c.v2_quote.final_charge_price);
      expect(snap.hard_price).toBe(c.v2_quote.final_charge_price);
      expect(snap.combo_key).toBe(c.v2_quote.combo_key);
      expect(snap.pricing_rule_version).toBeDefined();
      // Single fixed price, not a deprecated consume-budget
      // line-item breakdown.
      expect(snap.total_points).toBe(snap.hard_price);
      expect(snap.learning_points).toBeUndefined();
      expect(snap.writing_points).toBeUndefined();
      expect(snap.composing_points).toBeUndefined();
    },
  );
});
