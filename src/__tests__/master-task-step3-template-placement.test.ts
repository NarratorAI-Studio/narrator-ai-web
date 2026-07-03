/**
 * Placement regression for regression coverage.
 *
 * The row builder already has unit coverage; this test protects the actual
 * wizard JSX placement so the template details stay on Step 3 instead of
 * drifting back to the Step 4 confirmation page.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';


describe('master task template summary placement', () => {
  const pageSource = readFileSync(
    join(process.cwd(), 'src/app/page.tsx'),
    'utf8',
  );

  it('renders the template configuration card in Step 3 before the BGM section', () => {
    const step3Start = pageSource.indexOf('{wizardStep === 3');
    const step4Start = pageSource.indexOf('{/* Step 4 */}');

    expect(step3Start).toBeGreaterThanOrEqual(0);
    expect(step4Start).toBeGreaterThan(step3Start);

    const step3Source = pageSource.slice(step3Start, step4Start);
    const cardIndex = step3Source.indexOf('{templateSummaryCard}');
    const bgmIndex = step3Source.indexOf('{/* BGM */}');

    expect(cardIndex).toBeGreaterThanOrEqual(0);
    expect(bgmIndex).toBeGreaterThan(cardIndex);
  });

  it('does not render the template configuration detail card on Step 4', () => {
    const step4Start = pageSource.indexOf('{/* Step 4 */}');
    expect(step4Start).toBeGreaterThanOrEqual(0);

    const step4Source = pageSource.slice(step4Start);
    expect(step4Source).not.toContain('{templateSummaryCard}');
    expect(step4Source).not.toContain('templateSummary.show &&');
  });
});
