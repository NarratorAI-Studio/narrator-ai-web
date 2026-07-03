/**
 * Wallet API types for the hard-price lifecycle:
 * quote/pin → freeze → task create → confirm (success) / refund (failure)
 *
 * Backed by a compatible narrator-ai-web backend service.
 * narrator-ai-web is HTTP-only; all wallet state lives in the backend service.
 */

// ─── Quote / Pin ─────────────────────────────────────────────────────────────

export interface WalletQuoteRequest {
  template_id: number;
  combo_key: string;
  client_price: number;
}

export interface WalletQuoteResponse {
  quote_id: string;
  template_id: number;
  combo_key: string;
  hard_price: number;
  pricing_rule_version: string;
  expires_at: string;
}

// ─── Freeze ──────────────────────────────────────────────────────────────────

export interface WalletFreezeRequest {
  quote_id: string;
  idempotency_key: string;
}

export interface WalletFreezeResponse {
  transaction_id: string;
  quote_id: string;
  amount: number;
  status: WalletTransactionStatus;
  created_at: string;
}

// ─── Confirm ─────────────────────────────────────────────────────────────────

export interface WalletConfirmRequest {
  transaction_id: string;
  task_id: string;
}

export interface WalletConfirmResponse {
  transaction_id: string;
  status: WalletTransactionStatus;
  confirmed_at: string;
}

// ─── Refund ──────────────────────────────────────────────────────────────────

export interface WalletRefundRequest {
  transaction_id: string;
  reason?: string;
}

export interface WalletRefundResponse {
  transaction_id: string;
  status: WalletTransactionStatus;
  refunded_at: string;
}

// ─── Transaction Query ────────────────────────────────────────────────────────

export type WalletTransactionStatus =
  | 'frozen'
  | 'confirmed'
  | 'refunded'
  | 'expired'
  | 'failed';

/**
 * Billing summary block added by backend review (Backend API contract).
 * All monetary fields are decimal strings from the backend.
 * net_consumption is null when status=FROZEN (not yet settled).
 */
export interface BillingSummary {
  hard_price: string;
  discount_amount: string;
  refunded_amount: string;
  net_consumption: string | null;
}

export interface WalletTransaction {
  transaction_id: string;
  quote_id: string;
  template_id: number;
  combo_key: string;
  amount: number;
  pricing_rule_version: string;
  status: WalletTransactionStatus;
  task_id?: string;
  created_at: string;
  confirmed_at?: string;
  refunded_at?: string;
  expires_at?: string;
  billing_summary?: BillingSummary;
}

// ─── Snapshot stored in master task ──────────────────────────────────────────

export interface WalletTransactionSnapshot {
  transaction_id: string;
  quote_id: string;
  amount: number;
  status: WalletTransactionStatus;
  pricing_rule_version: string;
  idempotency_key: string;
}

// ─── UI state machine ─────────────────────────────────────────────────────────

export type HardPriceOrderState =
  | 'idle'
  | 'quoting'
  | 'freezing'
  | 'frozen'
  | 'creating_task'
  | 'confirming'
  | 'confirmed'
  | 'refunding'
  | 'refunded'
  | 'error';

export interface HardPriceOrderStateData {
  state: HardPriceOrderState;
  quote?: WalletQuoteResponse;
  transaction?: WalletFreezeResponse;
  error?: string;
}

// ─── BFF error response ───────────────────────────────────────────────────────

export interface WalletBffError {
  code: 'QUOTE_EXPIRED' | 'INSUFFICIENT_BALANCE' | 'ALREADY_CONFIRMED' | 'ALREADY_REFUNDED' | 'TRANSACTION_NOT_FOUND' | 'BACKEND_UNAVAILABLE' | 'UNKNOWN';
  message: string;
}
