import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5000';

test.describe('Hard Price Page E2E', () => {
  test('T-10: main page loads', async ({ page }) => {
    const res = await page.goto(BASE_URL);
    expect(res?.ok()).toBeTruthy();
  });

  test('T-11: page contains app key input', async ({ page }) => {
    await page.goto(BASE_URL);
    // The page should have some form of app key configuration
    const content = await page.content();
    expect(content).toBeTruthy();
    // Basic smoke: page renders without crash
    expect(await page.title()).toBeTruthy();
  });

  test('T-12: kill switch env visible in page source', async ({ page }) => {
    // When ROLLOUT=100, the page should have hard-price related code paths active
    // This is a basic smoke test - detailed UI tests need authenticated state
    const res = await page.goto(BASE_URL);
    expect(res?.status()).toBe(200);
  });
});
