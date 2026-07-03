import { expect, type Page, test } from '@playwright/test';

const MOBILE_VIEWPORT = { width: 390, height: 844 };

function isLocalBaseUrl(baseURL?: string) {
  return !!baseURL && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(baseURL);
}

async function expectNoPageOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(metrics.scrollWidth - metrics.clientWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(1);
  expect(metrics.bodyScrollWidth - metrics.clientWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(1);
}

async function mockCloudDrive(page: Page) {
  await page.route('**/api/cloud-drive/storage', route =>
    route.fulfill({
      json: {
        success: true,
        data: {
          used_size: 157286400,
          max_size: 1073741824,
          file_count: 2,
          usage_percentage: 14.6,
        },
      },
    }),
  );

  await page.route('**/api/cloud-drive/files**', route =>
    route.fulfill({
      json: {
        success: true,
        data: {
          total: 2,
          page: 1,
          page_size: 20,
          total_pages: 1,
          items: [
            {
              file_id: 'mobile-video-001',
              file_name: 'very-long-mobile-layout-regression-video-file-name.mp4',
              file_size: 126877696,
              suffix: 'mp4',
              category: 1,
              completed_time: '2026-06-10 10:00:00',
              created_at: '2026-06-10 10:00:00',
            },
            {
              file_id: 'mobile-srt-002',
              file_name: 'subtitle-regression-check.srt',
              file_size: 32768,
              suffix: 'srt',
              category: 2,
              completed_time: '2026-06-10 10:01:00',
              created_at: '2026-06-10 10:01:00',
            },
          ],
        },
      },
    }),
  );

  await page.route('**/api/cloud-drive/transfer**', route =>
    route.fulfill({ json: { success: true, data: { data: [] } } }),
  );
}

test.describe('mobile layout', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test.beforeEach(({ baseURL }) => {
    test.skip(
      !isLocalBaseUrl(baseURL),
      'mobile layout regression requires a local build of this PR',
    );
  });

  test('home page does not create horizontal page overflow', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('narratorai_app_key');
    });

    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();
    await expectNoPageOverflow(page);
  });

  test('cloud drive mobile list fits and keeps row actions visible', async ({ page }) => {
    await mockCloudDrive(page);
    await page.addInitScript(() => {
      localStorage.setItem('narratorai_app_key', 'mobile-layout-test-key');
    });

    await page.goto('/cloud-drive');
    await expect(page.getByTestId('cloud-file-mobile-row')).toHaveCount(2);
    await expectNoPageOverflow(page);

    for (const testId of [
      'cloud-file-download-mobile-video-001',
      'cloud-file-delete-mobile-video-001',
    ]) {
      const right = await page.getByTestId(testId).evaluate(element =>
        element.getBoundingClientRect().right,
      );
      expect(right).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
    }
  });
});
