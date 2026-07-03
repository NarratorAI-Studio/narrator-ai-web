/**
 * Unit tests for wallet BFF client error handling and response mapping.
 * Run with: pnpm add -D vitest && pnpm vitest
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before importing wallet-client
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// WALLET_BACKEND_URL must be set for non-mock mode
process.env.WALLET_BACKEND_URL = 'http://mock-wallet-backend';

const { walletClient, WalletError } = await import('@/lib/wallet-client');

function makeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('walletClient.quote', () => {
  it('returns quote data on success', async () => {
    const quoteData = {
      quote_id: 'q1',
      template_id: 1,
      combo_key: 'ck1',
      hard_price: 9.9,
      pricing_rule_version: 'v1',
      expires_at: '2099-01-01T00:00:00Z',
    };
    mockFetch.mockResolvedValue(makeResponse(200, quoteData));
    const result = await walletClient.quote('test-key', { template_id: 1, combo_key: 'ck1', client_price: 9.9 });
    expect(result).toEqual(quoteData);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://mock-wallet-backend/wallet/quotes',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws WalletError with INSUFFICIENT_BALANCE code on 402', async () => {
    mockFetch.mockResolvedValue(makeResponse(402, { code: 'INSUFFICIENT_BALANCE', message: '余额不足' }));
    await expect(
      walletClient.quote('test-key', { template_id: 1, combo_key: 'ck1', client_price: 9.9 }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
  });

  it('throws WalletError with UNKNOWN code on unexpected error body', async () => {
    mockFetch.mockResolvedValue(makeResponse(500, {}));
    await expect(
      walletClient.quote('test-key', { template_id: 1, combo_key: 'ck1', client_price: 9.9 }),
    ).rejects.toMatchObject({ code: 'UNKNOWN', statusCode: 500 });
  });

  it('throws WalletError with BACKEND_UNAVAILABLE on network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      walletClient.quote('test-key', { template_id: 1, combo_key: 'ck1', client_price: 9.9 }),
    ).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
  });
});

describe('walletClient.freeze', () => {
  it('returns frozen transaction on success', async () => {
    const txData = { transaction_id: 'tx1', quote_id: 'q1', amount: 9.9, status: 'frozen', created_at: '' };
    mockFetch.mockResolvedValue(makeResponse(200, txData));
    const result = await walletClient.freeze('test-key', { quote_id: 'q1', idempotency_key: 'ik1' });
    expect(result.transaction_id).toBe('tx1');
    expect(result.status).toBe('frozen');
  });

  it('forwards x-app-key header', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, { transaction_id: 'tx1', quote_id: 'q1', amount: 9.9, status: 'frozen', created_at: '' }));
    await walletClient.freeze('my-key', { quote_id: 'q1', idempotency_key: 'ik1' });
    const [, init] = mockFetch.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ 'x-app-key': 'my-key' });
  });
});

describe('walletClient.confirm', () => {
  it('returns confirmed status on success', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, { transaction_id: 'tx1', status: 'confirmed', confirmed_at: '' }));
    const result = await walletClient.confirm('test-key', { transaction_id: 'tx1', task_id: 'task1' });
    expect(result.status).toBe('confirmed');
  });

  it('throws WalletError with ALREADY_CONFIRMED on duplicate confirm', async () => {
    mockFetch.mockResolvedValue(makeResponse(409, { code: 'ALREADY_CONFIRMED', message: '已确认' }));
    await expect(
      walletClient.confirm('test-key', { transaction_id: 'tx1', task_id: 'task1' }),
    ).rejects.toMatchObject({ code: 'ALREADY_CONFIRMED' });
  });
});

describe('walletClient.refund', () => {
  it('returns refunded status on success', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, { transaction_id: 'tx1', status: 'refunded', refunded_at: '' }));
    const result = await walletClient.refund('test-key', { transaction_id: 'tx1', reason: 'task failed' });
    expect(result.status).toBe('refunded');
  });

  it('throws WalletError with ALREADY_REFUNDED on duplicate refund', async () => {
    mockFetch.mockResolvedValue(makeResponse(409, { code: 'ALREADY_REFUNDED', message: '已退款' }));
    await expect(
      walletClient.refund('test-key', { transaction_id: 'tx1' }),
    ).rejects.toMatchObject({ code: 'ALREADY_REFUNDED' });
  });
});

describe('walletClient.getTransaction', () => {
  it('returns transaction data on success', async () => {
    const tx = { transaction_id: 'tx1', quote_id: 'q1', template_id: 1, combo_key: 'ck1', amount: 9.9, pricing_rule_version: 'v1', status: 'confirmed', created_at: '' };
    mockFetch.mockResolvedValue(makeResponse(200, tx));
    const result = await walletClient.getTransaction('test-key', 'tx1');
    expect(result.transaction_id).toBe('tx1');
  });

  it('throws WalletError with TRANSACTION_NOT_FOUND on 404', async () => {
    mockFetch.mockResolvedValue(makeResponse(404, { code: 'TRANSACTION_NOT_FOUND', message: '交易不存在' }));
    await expect(walletClient.getTransaction('test-key', 'nonexistent')).rejects.toMatchObject({ code: 'TRANSACTION_NOT_FOUND' });
  });
});

describe('WalletError', () => {
  it('is an instance of Error', () => {
    const err = new WalletError('UNKNOWN', 'test', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('WalletError');
    expect(err.code).toBe('UNKNOWN');
    expect(err.statusCode).toBe(500);
  });
});
