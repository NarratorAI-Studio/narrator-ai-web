import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HardPriceApiError,
  queryHardPriceFromAPI,
  queryAllHardPricesFromAPI,
} from './hard-price-client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('queryHardPriceFromAPI', () => {
  it('returns detail on 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          template_id: 42,
          combo_key: 'original_narration_flash',
          hard_price: 84.5,
          text_chars: 2500,
          text_lines: 130,
          billing_duration_minutes: 6,
          pricing_rule_version: 1,
        },
      }),
    });

    const result = await queryHardPriceFromAPI(42, 'original_narration_flash');
    expect(result).not.toBeNull();
    expect(result!.hard_price).toBe(84.5);
    expect(result!.combo_key).toBe('original_narration_flash');
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await queryHardPriceFromAPI(999, 'original_narration_flash');
    expect(result).toBeNull();
  });

  it('throws on 500', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(queryHardPriceFromAPI(42, 'flash')).rejects.toThrow('Pricing API error: 500');
  });

  it('maps abort to BFF_UPSTREAM_TIMEOUT', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abort);

    await expect(queryHardPriceFromAPI(42, 'flash')).rejects.toMatchObject({
      name: 'HardPriceApiError',
      status: 504,
      code: 'BFF_UPSTREAM_TIMEOUT',
      retryable: true,
    } satisfies Partial<HardPriceApiError>);
  });

  it('calls correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    });
    await queryHardPriceFromAPI(42, 'original_narration_flash');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/pricing/hard-price'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('queryAllHardPricesFromAPI', () => {
  it('returns array on 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          template_id: 42,
          prices: [
            { combo_key: 'original_narration_flash', hard_price: 84.5 },
            { combo_key: 'original_narration_pro', hard_price: 109.5 },
          ],
        },
      }),
    });

    const result = await queryAllHardPricesFromAPI(42);
    expect(result).toHaveLength(2);
    expect(result[0].hard_price).toBe(84.5);
  });

  it('returns empty array on 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await queryAllHardPricesFromAPI(999);
    expect(result).toEqual([]);
  });

  it('throws on 500', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(queryAllHardPricesFromAPI(42)).rejects.toThrow('Pricing API error: 500');
  });
});
