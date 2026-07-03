/**
 * Unit tests for the Step 3 template-summary row builder (regression coverage, regression coverage).
 *
 * Acceptance-criteria coverage:
 *   - Template-library path: name / code / type / language / platform /
 *     categories surface in that order. (`价格档位` row removed per
 *     regression coverage — duplicate of quote/confirm-page info and frequently `-`.)
 *   - Custom-SRT path: mode label / SRT file / writing type / model.
 *   - Missing fields degrade to `-` (no layout collapse).
 *   - Card is hidden before any template selection signal appears.
 */

import { describe, expect, it } from 'vitest';

import {
  buildTemplateSummaryRows,
  shouldShowTemplateCard,
} from '@/lib/master-task-step3-template-summary';


describe('shouldShowTemplateCard', () => {
  it('false when no template selection has happened', () => {
    expect(
      shouldShowTemplateCard({
        useCustomTemplate: false,
        confirmedTemplate: null,
      }),
    ).toBe(false);
  });

  it('true on the template-library path', () => {
    expect(
      shouldShowTemplateCard({
        useCustomTemplate: false,
        confirmedTemplate: { name: '绿皮书' },
      }),
    ).toBe(true);
  });

  it('true on the custom-SRT path', () => {
    expect(
      shouldShowTemplateCard({
        useCustomTemplate: true,
        confirmedTemplate: null,
      }),
    ).toBe(true);
  });
});


describe('buildTemplateSummaryRows — template-library path', () => {
  it('surfaces every field in the documented order', () => {
    const rows = buildTemplateSummaryRows({
      useCustomTemplate: false,
      confirmedTemplate: {
        name: '绿皮书',
        code: 'xy0178',
        narrator_type: { name: '电影' },
        language: '中文',
        platform: { name: '抖音' },
        categories: [{ name: '剧情' }, { name: '获奖' }],
      },
    });

    expect(rows.map(r => r.label)).toEqual([
      '模板名称',
      '模板编号',
      '模板类型',
      '语言',
      '平台',
      '分类',
    ]);

    expect(rows[0].value).toBe('绿皮书');
    expect(rows[1].value).toBe('xy0178');
    expect(rows[2].value).toBe('电影');
    expect(rows[3].value).toBe('中文');
    expect(rows[4].value).toBe('抖音');
    expect(rows[5].value).toBe('剧情、获奖');
  });

  it('falls back to "-" for every missing optional field without layout collapse', () => {
    const rows = buildTemplateSummaryRows({
      useCustomTemplate: false,
      confirmedTemplate: { name: '绿皮书' },
    });

    // All six rows still present (layout stable).
    expect(rows.length).toBe(6);
    expect(rows[0].value).toBe('绿皮书');
    expect(rows.slice(1).every(r => r.value === '-')).toBe(true);
  });

  it('does not surface a 价格档位 row ', () => {
    const rows = buildTemplateSummaryRows({
      useCustomTemplate: false,
      confirmedTemplate: {
        name: '绿皮书',
      },
    });
    expect(rows.find(r => r.label === '价格档位')).toBeUndefined();
  });

  it('treats empty / whitespace strings as missing', () => {
    const rows = buildTemplateSummaryRows({
      useCustomTemplate: false,
      confirmedTemplate: {
        name: '   ',
        code: '',
        language: 'en',
        narrator_type: { name: undefined },
      },
    });
    expect(rows.find(r => r.label === '模板名称')!.value).toBe('-');
    expect(rows.find(r => r.label === '模板编号')!.value).toBe('-');
    expect(rows.find(r => r.label === '语言')!.value).toBe('en');
    expect(rows.find(r => r.label === '模板类型')!.value).toBe('-');
  });

  it('filters categories with empty names', () => {
    const rows = buildTemplateSummaryRows({
      useCustomTemplate: false,
      confirmedTemplate: {
        name: 'x',
        categories: [{ name: '剧情' }, {}, { name: '' }, { name: '获奖' }],
      },
    });
    expect(rows.find(r => r.label === '分类')!.value).toBe('剧情、获奖');
  });

  it('returns empty array when confirmedTemplate is null and not custom-SRT', () => {
    const rows = buildTemplateSummaryRows({
      useCustomTemplate: false,
      confirmedTemplate: null,
    });
    expect(rows).toEqual([]);
  });
});


describe('buildTemplateSummaryRows — custom-SRT path', () => {
  it('surfaces the custom-SRT mode rows in the documented order', () => {
    const rows = buildTemplateSummaryRows({
      useCustomTemplate: true,
      confirmedTemplate: null,
      learningSrt: { name: '盗梦空间.srt' },
      writingType: 1,
      writingModel: 'pro',
    });

    expect(rows.map(r => r.label)).toEqual([
      '模板类型',
      'SRT 文件',
      '文案类型',
      '文案模型',
    ]);
    expect(rows[0].value).toBe('自定义 SRT');
    expect(rows[1].value).toBe('盗梦空间.srt');
    expect(rows[2].value).toBe('原创文案');
    expect(rows[3].value).toBe('旗舰版');
  });

  it('handles missing SRT gracefully', () => {
    const rows = buildTemplateSummaryRows({
      useCustomTemplate: true,
      confirmedTemplate: null,
    });
    expect(rows.length).toBe(4);
    expect(rows.find(r => r.label === 'SRT 文件')!.value).toBe('-');
    expect(rows.find(r => r.label === '文案类型')!.value).toBe('-');
    expect(rows.find(r => r.label === '文案模型')!.value).toBe('-');
    expect(rows.find(r => r.label === '价格档位')).toBeUndefined();
  });

  it('uses the wizard-canonical label 旗舰版 for pro', () => {
    // The Select control on page.tsx renders <SelectItem value="pro">旗舰版,
    // budget-breakdown row says 旗舰版, task-detail page says 旗舰版, and
    // hard-price-utils combo labels say 旗舰版. Step 3 review card MUST
    // match — diverging to 专业版 here shows the user one label on
    // Step 2 selection and a different label on Step 3 review, which
    // looks like a wrong-pick bug.
    const rows = buildTemplateSummaryRows({
      useCustomTemplate: true,
      confirmedTemplate: null,
      writingModel: 'pro',
    });
    expect(rows.find(r => r.label === '文案模型')!.value).toBe('旗舰版');
  });

  it('uses 极速版 for flash (matches wizard SelectItem + budget rows)', () => {
    const rows = buildTemplateSummaryRows({
      useCustomTemplate: true,
      confirmedTemplate: null,
      writingModel: 'flash',
    });
    expect(rows.find(r => r.label === '文案模型')!.value).toBe('极速版');
  });

  it('passes through unknown writing model labels verbatim', () => {
    const rows = buildTemplateSummaryRows({
      useCustomTemplate: true,
      confirmedTemplate: null,
      writingModel: 'experimental-vNext',
    });
    expect(rows.find(r => r.label === '文案模型')!.value).toBe(
      'experimental-vNext',
    );
  });

  it('maps writingType 2 to 原创文案（带电影）', () => {
    const rows = buildTemplateSummaryRows({
      useCustomTemplate: true,
      confirmedTemplate: null,
      writingType: 2,
    });
    expect(rows.find(r => r.label === '文案类型')!.value).toBe(
      '原创文案（带电影）',
    );
  });

  it('prioritizes custom-SRT path over confirmedTemplate when both present', () => {
    // Defensive: the wizard shouldn't allow this state, but if it
    // happens we follow the user's explicit "use custom" intent.
    const rows = buildTemplateSummaryRows({
      useCustomTemplate: true,
      confirmedTemplate: { name: 'should-not-appear' },
      learningSrt: { name: 'foo.srt' },
    });
    expect(rows.find(r => r.label === '模板类型')!.value).toBe('自定义 SRT');
    expect(rows.find(r => r.label === 'SRT 文件')!.value).toBe('foo.srt');
    expect(rows.find(r => r.value === 'should-not-appear')).toBeUndefined();
  });
});
