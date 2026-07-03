import { test, expect } from '@playwright/test';

const PRICING_API = process.env.NARRATOR_PRICING_API_URL;
if (!PRICING_API) {
  throw new Error(
    'NARRATOR_PRICING_API_URL environment variable is required for e2e tests.'
  );
}

test.describe('Pricing API E2E', () => {
  test('T-10: health check', async ({ request }) => {
    const res = await request.get(`${PRICING_API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('T-10: golden value 262.80 for flash', async ({ request }) => {
    const res = await request.post(`${PRICING_API}/pricing/hard-price`, {
      data: { template_id: 1, combo_key: 'original_narration_flash' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.hard_price).toBe('262.80');
    expect(body.data.billing_duration_minutes).toBe(20);
  });

  test('T-10: all 5 tiers returned', async ({ request }) => {
    const res = await request.get(`${PRICING_API}/pricing/hard-price/all?template_id=1`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.prices).toHaveLength(5);
  });

  test('T-10: not found returns 404', async ({ request }) => {
    const res = await request.post(`${PRICING_API}/pricing/hard-price`, {
      data: { template_id: 999999, combo_key: 'original_narration_flash' },
    });
    expect(res.status()).toBe(404);
  });
});
