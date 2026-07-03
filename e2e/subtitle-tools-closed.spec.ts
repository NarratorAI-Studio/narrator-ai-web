import { expect, test } from '@playwright/test';

function isLocalBaseUrl(baseURL?: string) {
  return !!baseURL && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(baseURL);
}

test.describe('subtitle tools closure', () => {
  test.beforeEach(({ baseURL }) => {
    test.skip(
      !isLocalBaseUrl(baseURL),
      'subtitle tools closure checks require a local build of this PR',
    );
  });

  for (const path of ['/', '/narrator/tasks', '/cloud-drive', '/account']) {
    test(`hides toolbox navigation on ${path}`, async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.removeItem('narratorai_app_key');
      });

      await page.goto(path);

      await expect(page.getByText('工具箱')).toHaveCount(0);
      await expect(page.locator('a[href="/tools/subtitle-extract"]')).toHaveCount(0);
      await expect(page.locator('a[href="/tools/subtitle-removal"]')).toHaveCount(0);
    });
  }

  for (const path of ['/tools/subtitle-extract', '/tools/subtitle-removal']) {
    test(`shows unavailable state on direct visit to ${path}`, async ({ page }) => {
      await page.goto(path);

      await expect(page.getByRole('heading', { name: '暂未开放' })).toBeVisible();
      await expect(page.getByRole('button', { name: /创建字幕/ })).toHaveCount(0);
      await expect(page.getByText('当前不支持从独立工具页提交任务')).toBeVisible();
    });
  }
});
