/**
 * Types mirroring narrator-ai-web-backend's hard-price v2 quote API
 * (`POST /pricing/quote`).
 *
 * Used by:
 *   - `pricing-quote-backend-client.ts` (server-only)
 *   - `/api/narrator/pricing/quote` BFF route (server)
 *   - `useHardPriceQuoteV2` hook (client)
 */

export type PriceSource = 'manual_catalog_price' | 'system_calculated_price';

export interface PricingQuoteRequest {
  /**
   * Canonical upstream xy-code (e.g. `"xy0178"`). Preferred when present
   * — backend derives the local catalog `template_id` from it via
   * `template_id_from_baokuan_code` and stores both. The legacy
   * `template_id` below is ignored when `code` is given. See
   * Backend API contract.
   */
  code?: string | null;
  /**
   * Legacy local catalog id. Kept for backwards compat with quotes
   * generated before regression coverage and for backend integration tests that
   * exercise the manual path. Ignored when `code` is set.
   *
   * NB: this is NOT the narrator 主 ID (`CSV.id`) — that one is
   * carried on the master-task body's `template_id`; the two id
   * spaces are NOT interchangeable. Use `code` whenever possible.
   */
  template_id?: string | null;
  custom_template_id?: string | null;
  /** `_pro` suffix iff `pro_upgrade=true`. */
  combo_key: string;
  pro_upgrade?: boolean;
  /**
   * Required when `custom_template_id` is set. Points to a cloud-drive
   * file the requesting user owns (see Web API contract/regression coverage).
   * Backend resolves ownership, downloads bytes, hashes, and parses
   * server-side. The browser must not source billing hash/count metrics.
   */
  custom_srt_file_id?: string | null;
}

export interface PricingQuoteBreakdownItem {
  subflow_key: string;
  display_label: string;
  pricing_minutes: number;
  /**
   * Backend openapi declares this as integer, but custom-SRT decimal
   * rates (review fix) carry the un-truncated rate as a float. Web
   * never surfaces this field to C-end; kept here for completeness
   * and BFF debug logs.
   */
  unit_price: number;
  subtotal: number;
}

export interface PricingQuoteData {
  quote_id: string;
  pricing_rule_version: string;
  price_source: PriceSource;
  template_id: string | null;
  /**
   * Canonical xy-code echoed from the request . NULL for
   * legacy quotes generated before the column existed and for
   * custom_template quotes.
   */
  code: string | null;
  custom_template_id: string | null;
  combo_key: string;
  /** Tier starting price: Flash-side total. */
  starting_price: number | null;
  /** Settlement amount; what the wallet will be charged. */
  final_charge_price: number;
  flash_total: number;
  pro_total: number;
  /** `pro_total - flash_total`. Used by the optional Pro toggle badge. */
  pro_upgrade_delta: number;
  pricing_minutes: number;
  valid_line_count: number | null;
  /** Response-only backend-computed SRT hash, kept for debug/audit display. */
  srt_file_hash: string | null;
  breakdown: PricingQuoteBreakdownItem[];
  /** ISO-8601 UTC. After this point, commit will raise QUOTE_EXPIRED. */
  expires_at: string;
  currency_unit: 'web_point';
}

export interface PricingQuoteSuccessEnvelope {
  success: true;
  data: PricingQuoteData;
}

/**
 * Frozen error codes from `quote-snapshot-contract.md`. Web maps
 * each to a confirm-page UX state (re-quote / re-confirm / topup).
 */
export type PricingQuoteErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'WALLET_INSUFFICIENT_BALANCE'
  | 'CATALOG_TIER_MISSING'
  | 'QUOTE_COMBO_KEY_INVALID'
  // Server-authoritative custom SRT pricing errors.
  | 'CUSTOM_SRT_FILE_ID_MISSING'
  | 'CUSTOM_SRT_FILE_NOT_FOUND'
  | 'CUSTOM_SRT_FILE_TOO_LARGE'
  | 'CUSTOM_SRT_DOWNLOAD_FAILED'
  | 'CUSTOM_SRT_EMPTY'
  | 'QUOTE_VALIDATION_ERROR'
  | 'QUOTE_PERSISTENCE_ERROR'
  | 'BFF_AUTH_TOKEN_MISSING'
  | 'BFF_UPSTREAM_TIMEOUT'
  | 'BFF_UPSTREAM_UNREACHABLE'
  | 'BFF_INVALID_JSON'
  | 'UNKNOWN';

export interface PricingQuoteErrorEnvelope {
  success: false;
  error: {
    code: PricingQuoteErrorCode;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
}

export type PricingQuoteEnvelope =
  | PricingQuoteSuccessEnvelope
  | PricingQuoteErrorEnvelope;
